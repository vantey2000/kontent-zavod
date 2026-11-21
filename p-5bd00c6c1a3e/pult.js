/* Пульт: первая вкладка планера, вид «Приборы». Главная карточка денег со шкалой до цели и риской темпа,
   под ней сетка 2х2 плиток (одно крупное число и одна строка смысла), нажатие на плитку раскрывает
   подробности блока в ящике под сеткой. Цифры приходят снимком сборщика из ящика planer-relay (GET /pult),
   шифр и ключ те же, что у дел планера. Файл подключается после app.js и пользуется его именами
   (store, password, decrypt, fetchBlob, RELAY, DATA, VIEW, render, entries, dayObj, localToday).
   Наружу отдаёт три имени: renderPult, loadPult, pultSync. Всё остальное живёт внутри обёртки */
(function () {
  'use strict';
  const NB = '\u00a0';                 /* неразрывный пробел: записан кодом, чтобы редактор не превратил его в обычный */
  const INCOME_ON = true;              /* кнопка «Записать доход»: шторка планера шлёт боту команду «/доход …» (см. openIncome) */
  const STALE_MIN = 45;                /* снимок старше трёх прогонов сборщика считаем давним */

  /* числа и подписи: общие помощники вида */
  const FMT = {
    /* 1234567 -> «1 234 567» с неразрывными пробелами */
    num(n) { return n == null ? '' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB); },
    money(n) { return n == null ? '' : this.num(n) + NB + '₽'; },
    /* 901373 -> «901 тыс.», 5952 -> «5 952», 1250000 -> «1,25 млн» */
    short(n) {
      if (n == null) return '';
      if (n >= 1e6) return String(Math.round(n / 1e4) / 100).replace('.', ',') + NB + 'млн';
      if (n >= 1e5) return Math.round(n / 1e3) + NB + 'тыс.';
      if (n >= 1e4) return String(Math.round(n / 100) / 10).replace('.', ',') + NB + 'тыс.';
      return this.num(n);
    },
    /* минуты -> «7 ч 11 мин» */
    dur(min) { if (min == null) return ''; const h = Math.floor(min / 60), m = min % 60; return (h ? h + NB + 'ч ' : '') + m + NB + 'мин'; },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  };
  const f = () => FMT;
  const esc = (s) => FMT.esc(s);
  const MON_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  /* 1 день, 2 дня, 5 дней */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  const MON3 = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  /* время и дата берутся из самой строки снимка (её смещение = пояс сборщика, как в текстах тревог),
     а не из часов телефона: в поездке «с 17:43» в тревоге и на плитках не разойдутся */
  const hm = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso || ''); return m ? m[1] + ':' + m[2] : ''; };
  const day = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? (+m[3]) + NB + MON3[+m[2] - 1] : ''; };
  /* прирост со знаком: минус - обычный дефис, как во всех текстах */
  const delta = (n) => (n == null ? '' : (n > 0 ? '+' : n < 0 ? '-' : '') + f().num(Math.abs(n)));
  /* хвост из одного короткого слова не отрывается от строки: «порог 0,5», «с 17:43» */
  const glue = (s) => String(s || '').replace(/ (\S{1,6})$/, NB + '$1');
  const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  const dateOf = (s) => new Date(s + 'T12:00:00');
  const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  /* возраст в минутах -> «2 мин», «7 ч», «4 дн» */
  function age(min) {
    if (min == null) return '';
    if (min < 60) return Math.round(min) + NB + 'мин';
    if (min < 1440) return Math.round(min / 60) + NB + 'ч';
    return Math.round(min / 1440) + NB + 'дн';
  }
  const tag = (txt, cls) => '<span class="p-tagx ' + (cls || '') + '">' + esc(txt) + '</span>';
  const lamp = (st, label) => '<i class="p-lamp p-' + st + '" role="img" aria-label="' + esc(label) + '"></i>';
  /* деньги крупно: число Oswald, знак рубля мельче */
  const bigMoney = (n) => '<span class="p-num">' + f().num(n) + '</span><span class="p-rub">₽</span>';

  /* ---------- деньги: главная карточка ---------- */
  function moneyCard(B) {
    const mb = B.money || {};
    const m = mb.data || {};
    if (mb.status === 'empty' || !m.month || m.month.sum == null) {
      return '<article class="p-money p-card"><div class="p-head"><span class="p-lbl">Деньги</span></div>' +
        '<p class="p-nodata">Нет данных о деньгах: сборщик ещё ни разу их не прислал</p>' +
        (INCOME_ON ? '<div class="p-acts"><button class="btn p-btn" type="button" data-p-income="1">Записать доход</button></div>' : '') + '</article>';
    }
    /* цель есть, только если она больше нуля: без неё нет ни шкалы, ни «цель взята», ни темпа */
    const goal = m.goal > 0 ? m.goal : null, sum = m.month.sum, pc = m.pace || {};
    const mon = m.day ? MON_NOM[dateOf(m.day).getMonth()] : '';
    const val = (n) => (n != null ? f().money(n) : '<span class="p-nd">нет данных</span>');
    const left = pc.dim != null && pc.dom != null ? pc.dim - pc.dom + 1 : null;
    /* темп называем, только если сборщик его посчитал и цель задана: иначе «в темпе» было бы выдумкой */
    const st = goal && { ahead: 1, on: 1, behind: 1 }[pc.state] ? pc.state : '';
    const stWord = { ahead: 'опережаем', on: 'в темпе', behind: 'отстаём' }[st];
    const chip = !st ? ''
      : st === 'behind'
        ? '<span class="p-pace p-behind">' + stWord + (pc.diff != null ? NB + delta(pc.diff) + NB + '₽' : '') + '</span>'
        : '<span class="p-pace p-' + st + '">' + stWord + (pc.diff > 0 ? NB + delta(pc.diff) + NB + '₽' : '') + '</span>';

    /* шкала: деления 0..цель, факт, зона недобора до темпа, риска «где должны быть сегодня» */
    const cap = Math.max(goal || 0, sum, 1);
    const pos = (v) => Math.max(0, Math.min(100, v / cap * 100));
    const xF = pos(sum), xE = pos(pc.expected || 0);
    let ticks = '';
    for (let i = 0; i <= 5; i++) {
      const v = goal * i / 5;
      ticks += '<span class="p-tick' + (i === 5 ? ' p-end' : '') + '" style="left:' + pos(v) + '%"><b>' +
        (i === 0 ? '0' : Math.round(v / 1000)) + '</b></span>';
    }
    let minor = '';
    for (let i = 1; i < 10; i++) if (i % 2) minor += '<i style="left:' + pos(goal * i / 10) + '%"></i>';
    const gap = st === 'behind' && xE > xF
      ? '<span class="p-gap" style="left:' + xF + '%;width:' + (xE - xF) + '%"></span>' : '';
    const markAlign = xE > 55 ? ' p-r' : '';
    const hasExp = pc.expected != null;
    const scale = !goal ? '' :
      '<div class="p-scale" role="img" aria-label="' + esc('Месяц ' + f().money(sum) + ' из ' + f().money(goal) + (hasExp ? ', по темпу сегодня должно быть ' + f().money(pc.expected) : '')) + '">' +
        (hasExp ? '<div class="p-mark' + markAlign + '" style="left:' + xE + '%"><span>по темпу ' + esc(f().short(pc.expected)) + '</span></div>' : '') +
        '<div class="p-track"><span class="p-fill" style="width:' + xF + '%"></span>' + gap + '<span class="p-minor">' + minor + '</span></div>' +
        (hasExp ? '<div class="p-pin" style="left:' + xE + '%"></div>' : '') +
        '<div class="p-ticks">' + ticks + '</div>' +
      '</div>';

    const need = !goal || (goal - sum > 0 && pc.need_per_day == null) ? ''
      : goal - sum <= 0
        ? '<p class="p-need p-done">Цель месяца взята</p>'
        : '<p class="p-need' + (st === 'behind' ? ' p-warn' : '') + '">Нужно <b>' + f().money(pc.need_per_day) + '</b> в день' +
          (left != null ? '<span>осталось ' + left + NB + plural(left, 'день', 'дня', 'дней') + '</span>' : '') + '</p>';

    /* источник не ответил в этот прогон: сумма по нему взята с прошлой сверки (не «не продаётся») */
    const fNames = (m.by || []).filter((r) => (m.failed || []).indexOf(r.id) >= 0).map((r) => r.name);
    const fl = (m.failed || []).length
      ? '<span class="p-amb p-blk">' + (fNames.length ? esc(fNames.join(', ')) : 'Источник денег') + ': нет ответа, ' +
        (fNames.length > 1 ? 'суммы старые' : 'сумма старая') + '</span>' : '';
    const unc = m.unconfirmed || fl
      ? '<p class="p-unc">' + (m.unconfirmed ? 'из них ' + f().money(m.unconfirmed) + ' не сверено' : '') + fl + '</p>' : '';
    const failed = '';
    const staleNote = mb.status === 'stale'
      ? '<p class="p-unc p-warn">цифры с ' + hm(mb.at) + ', сборщик денег не ответил</p>' : '';

    const cell = (lbl, val, sub) => '<div class="p-cell"><span class="p-lbl">' + lbl + '</span><b>' + val + '</b>' + (sub ? '<span class="p-sub">' + sub + '</span>' : '') + '</div>';
    return '<article class="p-money p-card">' +
      '<div class="p-head"><span class="p-lbl">Деньги' + (mon ? ' · ' + mon : '') + '</span>' + chip + '</div>' +
      '<div class="p-big">' + bigMoney(sum) + '<span class="p-of">' + (goal ? 'из ' + f().money(goal) : 'цель не задана') + '</span></div>' +
      unc + failed + staleNote +
      scale + need +
      '<div class="p-cells">' +
        cell('Сегодня', val((m.today || {}).sum), m.day ? esc(day(m.day)) + ', по Москве' : '') +
        cell('7 дней', val((m.d7 || {}).sum)) +
        cell('Прогноз', val(pc.forecast)) +
      '</div>' +
      '<div class="p-acts">' +
        '<button class="btn p-btn" type="button" data-p-tile="money" aria-expanded="false" aria-controls="p-drawer">' +
          '<span class="p-ta" data-p-ta="Показать состав" data-p-tc="Свернуть состав">Показать состав</span></button>' +
        (INCOME_ON ? '<button class="btn p-btn p-pri" type="button" data-p-income="1">Записать доход</button>' : '') +
      '</div>' +
    '</article>';
  }

  /* ---------- общее для плиток ---------- */
  function todayYmd(P) { return P.today || ymd(new Date()); }
  /* минуты от полуночи «сейчас» для дел дня: часы устройства, если день совпадает с днём планера */
  function nowMinutes(P, S) {
    const d = new Date();
    if (ymd(d) === todayYmd(P)) return d.getHours() * 60 + d.getMinutes();
    const u = new Date(S.updated || Date.now());
    if (ymd(u) === todayYmd(P)) return u.getHours() * 60 + u.getMinutes();
    return 0;
  }
  function agenda(P, nowMin) {
    const list = (P.entries || []).slice().sort((a, b) => a.s - b.s);
    const next = list.find((e) => !e.done && e.e > nowMin) || null;
    return { list, next, done: P.done_today || 0, total: P.total_today != null ? P.total_today : list.length };
  }
  /* неделя зала в снимке бывает прошлой (снимок из памяти телефона после выходных, давний блок): тогда на текущей
     неделе тренировок ноль, а не число прошлой. known = трекер прислал и план, и счёт недели */
  function gymWeek(g, today) {
    const w = g.week || {};
    const back = (dateOf(today).getDay() + 6) % 7;            /* сколько дней прошло с понедельника */
    const cur = !!w.start && daysBetween(w.start, today) >= 0 && daysBetween(w.start, today) < 7;
    return { known: g.plan_week != null && w.done != null, cur, plan: g.plan_week, done: cur ? (w.done || 0) : 0,
      days: cur ? (w.days || []) : [], start: cur ? w.start : addDays(today, -back), left: 7 - (cur ? daysBetween(w.start, today) : back) };
  }
  function gymState(g, today) {
    if (!g || !g.week) return 'none';
    const gw = gymWeek(g, today);
    const left = gw.left;
    const need = (gw.plan || 0) - gw.done;
    if (need <= 0) return 'ok';
    const lastAgo = g.last ? daysBetween(g.last, today) : 99;
    return need > left || lastAgo > 7 ? 'amber' : 'ok';
  }

  /* последние шаги и последний сон из блока здоровья. null = телефон ещё ничего не присылал */
  function healthNow(B, ctx) {
    const hb = B.health || {}, hd = hb.data || {};
    const days = (hd.days || []).filter((d) => d && d.d && d.d <= ctx.today);
    if (hb.status === 'empty' || !days.length) return null;
    const back = days.slice().reverse();
    const st = back.find((d) => d.steps != null), sl = back.find((d) => d.sleep_min != null);
    if (!st && !sl) return null;
    const push = hd.last_push || '';
    /* stepsPart: шаги прошлого дня так и остались неполными (на следующий день телефон их не пересчитал) */
    return { steps: st ? st.steps : null, stepsDay: st ? st.d : null, stepsPart: !!(st && st.steps_part && st.d !== ctx.today),
      sleep: sl ? sl.sleep_min : null, sleepDay: sl ? sl.d : null,
      inBed: !!(sl && sl.sleep_in_bed), push, old: hb.status === 'stale' || !((Date.now() - Date.parse(push)) / 3600000 < 36) };
  }

  /* плитка = кнопка: внизу строка-действие со словом («открыть площадки»), у открытой - «свернуть» */
  const ACT = { main: 'открыть список', today: 'открыть все дела', aud: 'открыть площадки', gym: 'открыть недели' };
  function tile(key, label, ind, num, line, state, numCls, act) {
    const a = act || ACT[key];
    return '<button class="p-tile p-st-' + state + '" type="button" data-p-tile="' + key + '" aria-expanded="false" aria-controls="p-drawer">' +
      '<span class="p-th"><span class="p-lbl">' + label + '</span>' + ind + '</span>' +
      '<span class="p-tn' + (numCls ? ' ' + numCls : '') + '">' + num + '</span>' +
      '<span class="p-tl">' + line + '</span>' +
      '<span class="p-ta" data-p-ta="' + esc(a) + '" data-p-tc="свернуть">' + esc(a) + '</span>' +
    '</button>';
  }

  function tiles(S, P, ctx) {
    const B = S.blocks || {};
    const att = S.attention || [];
    const reds = att.filter((a) => a.level === 'red').length, ambers = att.length - reds;
    const out = [];

    /* главное сейчас / автоматизации */
    const mc = B.machines || {}, md = mc.data || {};
    if (att.length) {
      /* крупное число = сигналы, и это сказано словом; красным только «срочно», «проверить» янтарём */
      const parts = [];
      if (reds) parts.push('<b class="p-red-t">' + reds + NB + 'срочно</b>');
      if (ambers) parts.push('<b class="p-amb">' + ambers + NB + 'проверить</b>');
      out.push(tile('main', 'Главное сейчас', lamp(reds ? 'red' : 'amber', reds ? 'есть срочное' : 'есть что проверить'),
        att.length + '<small>' + NB + plural(att.length, 'сигнал', 'сигнала', 'сигналов') + '</small>', parts.join(' · '),
        reds ? 'red' : 'amber', reds ? 'p-c-red' : 'p-c-amb', 'открыть сигналы'));
    } else if (mc.status === 'empty' || md.total == null || !md.counts) {
      out.push(tile('main', 'Главное сейчас', lamp('none', 'нет данных'), 'нет', 'автоматизации не подключены', 'none', 'p-c-mut'));
    } else {
      /* «32/32» без предмета не читается: предмет назван в строке, время проверки в конце */
      const c = md.counts || {}, ok = c.ok || 0;
      const what = plural(ok, 'автоматизация', 'автоматизации', 'автоматизаций') + ' в' + NB + 'порядке';
      const ln = mc.status === 'stale'
        ? what + '<span class="p-amb p-blk">данные с' + NB + hm(mc.at) + '</span>'
        : what + ' ·' + NB + hm(mc.at);
      out.push(tile('main', 'Главное сейчас', lamp(mc.status === 'stale' ? 'amber' : 'ok', mc.status === 'stale' ? 'данные старые' : 'всё в порядке'),
        ok + '<small>/' + md.total + '</small>', ln, mc.status === 'stale' ? 'amber' : 'ok'));
    }

    /* сегодня */
    const ag = ctx.ag;
    const cnt = '<span class="p-cnt">' + ag.done + '/' + ag.total + '</span>';
    if (!ag.total) {
      out.push(tile('today', 'Сегодня', cnt, '0', 'дел на сегодня нет', 'info'));
    } else if (ag.next) {
      const going = ag.next.s <= ctx.nowMin;
      out.push(tile('today', going ? 'Сейчас идёт' : 'Дальше', cnt, hhmm(ag.next.s),
        '<span class="p-clamp">' + esc(ag.next.title) + '</span>', 'info'));
    } else if (ag.done >= ag.total) {
      out.push(tile('today', 'Сегодня', cnt, ag.done + '<small>/' + ag.total + '</small>', 'всё сделано', 'ok'));
    } else {
      const rest = ag.total - ag.done;
      out.push(tile('today', 'Сегодня', cnt, ag.done + '<small>/' + ag.total + '</small>',
        rest + NB + plural(rest, 'дело', 'дела', 'дел') + ' не отмечено', 'amber'));
    }

    /* подписчики */
    const au = B.audience || {}, ad = au.data || {};
    if (au.status === 'empty' || ad.total == null) {
      out.push(tile('aud', 'Подписчики', lamp('none', 'нет данных'), 'нет', 'площадки не подключены', 'none', 'p-c-mut'));
    } else {
      const items = ad.items || [];
      const counted = items.filter((i) => i.value != null);
      const approx = counted.some((i) => !i.exact);              /* YouTube отдаёт округлённое: итог тоже «≈», как в ящике */
      const silent = counted.filter((i) => i.status === 'stale');
      const blockStale = au.status === 'stale';
      /* прирост только по свежим площадкам: молчащая шлёт старый прирост, в сумму его не берём */
      const withD = blockStale ? [] : counted.filter((i) => i.status !== 'stale' && i.d1 != null);
      let ln;
      if (withD.length) {
        const d1 = withD.reduce((s, i) => s + i.d1, 0);
        const apx = withD.some((i) => !i.exact);
        ln = '<b class="' + (d1 < 0 ? 'p-amb' : 'p-up') + '">' + (apx ? '≈' + NB : '') + delta(d1) + '</b> за' + NB + 'сутки' +
          (withD.length < counted.length ? ' по' + NB + withD.length + NB + plural(withD.length, 'площадке', 'площадкам', 'площадкам') : '');
      } else if (blockStale) {
        ln = 'прирост не считаем';
      } else {
        ln = 'прирост копится с' + NB + day(ad.since);
      }
      if (silent.length) ln += '<span class="p-amb p-blk">' + esc(silent.length > 2 ? silent.length + NB + plural(silent.length, 'площадка', 'площадки', 'площадок') : silent.map((i) => i.name).join(', ')) +
        NB + (silent.length > 1 ? 'молчат' : 'молчит') + '</span>';
      if (blockStale) ln += '<span class="p-amb p-blk">данные с' + NB + hm(au.at) + '</span>';
      const warn = silent.length || blockStale;
      /* справа сверху: сколько площадок в итоге (ВК без адреса не считается); зелёной лампы «всё сверено» нет */
      const ind = '<span class="p-cnt" aria-label="' + esc('в итоге ' + counted.length + ' из ' + items.length + ' площадок') + '">' +
        (warn ? lamp('amber', 'есть молчащие площадки') : '') + counted.length + NB + 'из' + NB + items.length + '</span>';
      out.push(tile('aud', 'Подписчики', ind,
        (approx ? '<small>≈' + NB + '</small>' : '') + f().num(ad.total), ln, warn ? 'amber' : 'ok', ad.total >= 1e6 ? 'p-long' : ''));
    }

    /* здоровье и зал: Иван просил видеть шаги за день и сон. Когда телефон их прислал, плитка про них,
       а зал остаётся точками вверху плитки и в подробностях; пока телефон молчит, плитка про зал */
    const gb = B.gym || {}, g = gb.data || {};
    const hs = healthNow(B, ctx);
    if (hs) {
      const gw = g.week && gb.status !== 'empty' && gymWeek(g, ctx.today).known ? gymWeek(g, ctx.today) : null;
      let pips = lamp(hs.old ? 'amber' : 'ok', hs.old ? 'данные давние' : 'данные свежие');
      if (gw) {
        pips = '<span class="p-pips" role="img" aria-label="' + esc('зал на этой неделе ' + gw.done + ' из ' + gw.plan) + '">';
        for (let i = 0; i < (gw.plan || 0); i++) pips += '<i' + (i < gw.done ? ' class="p-on"' : '') + '></i>';
        pips += '</span>';
      }
      const when = (d) => (d === ctx.today ? 'сегодня' : daysBetween(d, ctx.today) === 1 ? 'вчера' : day(d));
      let ln = hs.steps != null
        ? plural(hs.steps, 'шаг', 'шага', 'шагов') + ' ' + (hs.stepsDay === ctx.today ? 'за' + NB + 'сегодня' : esc(when(hs.stepsDay)) + (hs.stepsPart ? ', день неполный' : ''))
        : 'шагов в данных нет';
      ln += '<span class="p-blk">' + (hs.sleep != null
        ? (hs.inBed ? 'в постели ' : 'сон ') + (hs.sleepDay === ctx.today ? '' : esc(when(hs.sleepDay)) + ' ') + '<b>' + durS(hs.sleep) + '</b>'
        : 'сна в данных нет') + '</span>';
      if (hs.old) ln += '<span class="p-amb p-blk">телефон молчит' + (hs.push ? ' с' + NB + esc(day(hs.push)) : '') + '</span>';
      out.push(tile('gym', 'Здоровье и зал', pips, hs.steps != null ? f().num(hs.steps) : 'нет', ln, hs.old ? 'amber' : 'ok',
        hs.steps == null ? 'p-c-mut' : (hs.steps >= 100000 ? 'p-long' : ''), 'открыть подробности'));
    } else if (gb.status === 'empty' || !g.week) {
      out.push(tile('gym', 'Зал и здоровье', lamp('none', 'нет данных'), 'нет', 'трекер зала не подключён', 'none', 'p-c-mut'));
    } else if (!gymWeek(g, ctx.today).known) {
      out.push(tile('gym', 'Зал и здоровье', lamp('none', 'нет данных'), 'нет', 'трекер зала не прислал счёт недели', 'none', 'p-c-mut'));
    } else {
      const gw = gymWeek(g, ctx.today);
      const old = gb.status === 'stale';
      const st = old ? 'amber' : gymState(g, ctx.today);
      let pips = '<span class="p-pips" aria-hidden="true">';
      for (let i = 0; i < (gw.plan || 0); i++) pips += '<i' + (i < gw.done ? ' class="p-on"' : '') + '></i>';
      pips += '</span>';
      let ln = 'тренировок пока нет';
      if (g.last) {
        const ago = daysBetween(g.last, ctx.today);
        ln = 'последняя ' + day(g.last) + (ago >= 2 ? ', ' + ago + NB + plural(ago, 'день', 'дня', 'дней') + NB + 'назад' : ago === 1 ? ', вчера' : ', сегодня');
      }
      /* давний блок: трекер не ответил, цифры прошлые, и это сказано на плитке */
      if (old) ln += '<span class="p-blk">данные с' + NB + (String(gb.at || '').slice(0, 10) === ctx.today ? hm(gb.at) : day(gb.at)) + '</span>';
      out.push(tile('gym', 'Зал и здоровье', pips, gw.done + '<small>/' + gw.plan + '</small>',
        st === 'amber' ? '<span class="p-amb">' + ln + '</span>' : ln, st));
    }
    /* порядок на экране: главное, подписчики, затем дела дня и зал. Подписчики в первом ряду, чтобы прирост
       за сутки был виден без прокрутки на высоте настоящего телефона (вырез сверху, полоска снизу) */
    /* третий ряд (22.11): контент дня и вайб-кодинг, файл pult.work.js */
    /* заявки (22.11) широкой плиткой выше контента: это деньги; файл pult.leads.js */
    return '<div class="p-grid">' + [out[0], out[2], out[1], out[3], tileLeads(S), tileContent(S), tileVibe(S)].join('') + '</div>';
  }

  /* полоса «срочно»: первая красная строка поднимается над всем */
  function alarm(S) {
    const att = S.attention || [];
    const red = att.find((a) => a.level === 'red');
    if (!red) return '';
    const more = att.length - 1;
    return '<button class="p-alarm" type="button" data-p-tile="main" aria-controls="p-drawer">' +
      '<span class="p-lbl">Срочно' + (more ? '<em> · ещё ' + more + NB + plural(more, 'сигнал', 'сигнала', 'сигналов') + '</em>' : '') + '</span>' +
      '<span class="p-at">' + esc(glue(red.text)) + '</span><span class="p-go">Открыть</span></button>';
  }

  /* ---------- ящик: подробности выбранного прибора ---------- */
  const durS = (m) => (m >= 60 ? Math.floor(m / 60) + NB + 'ч' + (m % 60 ? ' ' + (m % 60) + NB + 'мин' : '') : m + NB + 'мин');
  /* то же для крупной цифры в окошке: единицы мельче, как «кг», чтобы «10 ч 45 мин» влезло в поле */
  const durH = (m) => (m >= 60 ? Math.floor(m / 60) + '<small>' + NB + 'ч</small> ' + (m % 60 ? (m % 60) + '<small>' + NB + 'мин</small>' : '') : m + '<small>' + NB + 'мин</small>');
  const STATE_WORD = { ok: 'в порядке', late: 'опаздывает', down: 'не работает', warn: 'ошибка в журнале' };
  const ST_LAMP = { ok: 'ok', late: 'amber', warn: 'amber', down: 'red' };

  function drawerToday(S, P, ctx) {
    const ag = ctx.ag;
    if (!ag.list.length) return '<p class="p-line">На сегодня в планере пусто</p>';
    const rows = ag.list.map((e) => {
      const nx = ag.next && e === ag.next;
      return '<div class="row ' + esc(e.kind || '') + (e.done ? ' done' : '') + (nx ? ' p-nx' : '') + '">' +
        '<span class="tm">' + hhmm(e.s) + '</span><span class="k"></span>' +
        '<span class="ttl">' + (nx ? '<span class="p-lbl p-acc">' + (e.s <= ctx.nowMin ? 'сейчас' : 'дальше') + '</span>' : '') +
          esc(e.title) + '<span class="sub">' + hhmm(e.s) + '-' + hhmm(e.e) + ' · ' + durS(e.e - e.s) + '</span></span></div>';
    }).join('');
    return '<p class="p-line">Сделано <b>' + ag.done + ' из ' + ag.total + '</b>' +
      (P.load ? ' · занято ' + durS(P.load) : '') + '</p><div class="agenda p-agenda">' + rows + '</div>';
  }

  function drawerMain(S, P, ctx) {
    const B = S.blocks || {};
    const mc = B.machines || {}, md = mc.data || {};
    const att = (S.attention || []).slice().sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
    const noMach = mc.status === 'empty' || md.total == null || !md.counts;
    let h = '';
    if (att.length) {
      h += '<ul class="p-att">' + att.map((a) =>
        '<li class="p-' + (a.level === 'red' ? 'red' : 'amber') + '">' + lamp(a.level === 'red' ? 'red' : 'amber', a.level === 'red' ? 'срочно' : 'проверить') +
        '<span>' + esc(glue(a.text)) + '</span><em>' + (a.level === 'red' ? 'срочно' : 'проверить') + '</em></li>').join('') + '</ul>';
    } else if (!noMach) {
      h += '<p class="p-calm">' + lamp('ok', 'всё работает') + 'Всё работает, тревог нет. Проверено' + NB + hm(mc.at || S.updated) + '</p>';
    }
    if (noMach) return h + '<p class="p-line">Автоматизации ещё не подключены к пульту</p>';

    /* счётчики ресурсов */
    h += '<div class="p-meters">' + (md.meters || []).map((m) => {
      const v = typeof m.value === 'number' ? String(m.value).replace('.', ',') : esc(m.value);
      const bar = m.unit === '%' && typeof m.value === 'number'
        ? '<span class="p-meter"><i style="width:' + Math.min(100, m.value) + '%"></i></span>' : '';
      return '<div class="p-mt p-st-' + (ST_LAMP[m.state] || 'ok') + '">' +
        '<span class="p-th"><span class="p-lbl">' + esc(m.title) + '</span>' + lamp(ST_LAMP[m.state] || 'ok', m.state) + '</span>' +
        '<b>' + v + (m.unit ? '<small>' + NB + esc(m.unit) + '</small>' : '') + '</b>' + bar +
        (m.note ? '<span class="p-sub">' + esc(m.note) + '</span>' : '') + '</div>';
    }).join('') + '</div>';

    /* автоматизации по группам */
    const c = md.counts || {};
    h += '<p class="p-line p-sec">Автоматизации: <b>' + (c.ok || 0) + ' из ' + md.total + '</b> в порядке' +
      (mc.status === 'stale' ? ' <span class="p-amb">· данные с ' + hm(mc.at) + '</span>' : '') + '</p>';
    h += '<div class="p-groups">' + (md.groups || []).map((g, gi) => {
      const bad = g.items.filter((i) => i.state !== 'ok');
      const open = ctx.openGroups.has(gi);
      const worst = bad.some((i) => i.state === 'down') ? 'red' : bad.length ? 'amber' : 'ok';
      const sum = bad.length ? bad.length + NB + plural(bad.length, 'сбой', 'сбоя', 'сбоев') : 'все в порядке';
      const items = open ? '<ul class="p-items">' + g.items.map((i) =>
        '<li class="p-st-' + (ST_LAMP[i.state] || 'ok') + '">' + lamp(ST_LAMP[i.state] || 'ok', STATE_WORD[i.state] || i.state) +
        '<span class="p-it">' + esc(i.title) + (i.state !== 'ok' ? '<em>' + STATE_WORD[i.state] + (i.note ? ', ' + esc(i.note) : '') + '</em>' : '') + '</span>' +
        '<span class="p-age">' + (i.age_min != null ? age(i.age_min) + ' назад' : 'работает') + '</span></li>').join('') + '</ul>' : '';
      return '<div class="p-grp' + (open ? ' p-open' : '') + '">' +
        '<button class="p-gh" type="button" data-p-grp="' + gi + '" aria-expanded="' + open + '">' + lamp(worst, sum) +
        '<span class="p-gn">' + esc(g.name) + '</span><span class="p-gc">' + g.items.length + ' · ' + sum + '</span><span class="p-chev" aria-hidden="true"></span></button>' +
        items + '</div>';
    }).join('') + '</div>';
    return h;
  }

  function spark(series) {
    if (!series || series.length < 3) return '';
    const vs = series.map((p) => p.v), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    const W = 64, H = 22, span = hi - lo || 1;
    const pts = vs.map((v, i) => (i / (vs.length - 1) * (W - 4) + 2).toFixed(1) + ',' + (H - 3 - (v - lo) / span * (H - 6)).toFixed(1)).join(' ');
    const last = pts.split(' ').pop().split(',');
    return '<svg class="p-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3"/></svg>';
  }

  function drawerAud(S, P, ctx) {
    const au = (S.blocks || {}).audience || {}, ad = au.data || {};
    if (au.status === 'empty' || ad.total == null) return '<p class="p-line">Площадки ещё не подключены к пульту</p>';
    const items = ad.items || [];
    const counted = items.filter((i) => i.value != null);
    const approx = counted.some((i) => !i.exact);
    let h = '<p class="p-line">Всего <b>' + (approx ? '≈' + NB : '') + f().num(ad.total) + '</b> на ' + counted.length + ' ' +
      plural(counted.length, 'площадке', 'площадках', 'площадках') + ' из ' + items.length +
      (au.status === 'stale' ? ' <span class="p-amb">· данные с ' + hm(au.at) + '</span>' : '') + '</p>';
    h += '<ul class="p-aud">' + items.map((i) => {
      let val, meta;
      if (i.status !== 'off' && i.value == null) {
        val = '<span class="p-off">нет данных</span>';
        meta = '<span class="p-sub p-amb">площадка ещё ни разу не ответила' + (i.error ? ', ' + esc(i.error) : '') + '</span>';
      } else if (i.status === 'off') {
        val = '<span class="p-off">нет адреса</span>';
        meta = '<span class="p-sub">адрес не задан, площадка не считается</span>';
      } else {
        val = (i.exact ? '' : '≈' + NB) + f().num(i.value);
        const gr = i.d1 == null && i.d7 == null
          ? 'прирост копится с' + NB + day(ad.since)
          : [i.d1 != null ? '<b class="' + (i.d1 < 0 ? 'p-amb' : 'p-up') + '">' + delta(i.d1) + '</b> за' + NB + 'сутки' : '',
             i.d7 != null ? delta(i.d7) + ' за' + NB + 'неделю' : ''].filter(Boolean).join(' · ');
        const when = i.status === 'stale'
          ? '<span class="p-amb">молчит с' + NB + hm(i.at) + (i.error ? ', ' + esc(i.error) : '') + '</span>'
          : 'сверено' + NB + hm(i.at) + (i.exact ? '' : ', округлено');
        meta = '<span class="p-sub">' + gr + '</span><span class="p-sub">' + when + '</span>';
      }
      return '<li class="p-st-' + (i.status === 'stale' ? 'amber' : i.status === 'off' ? 'none' : 'ok') + '">' +
        '<span class="p-an"><b>' + esc(i.name) + '</b>' + meta + '</span>' + spark(i.series) +
        '<span class="p-av">' + val + '</span></li>';
    }).join('') + '</ul>';
    return h;
  }

  function addDays(s, n) { const d = dateOf(s); d.setDate(d.getDate() + n); return ymd(d); }

  function drawerGym(S, P, ctx) {
    const B = S.blocks || {};
    const gb = B.gym || {}, g = gb.data || {};
    let h = '';
    if (gb.status === 'empty' || !g.week) {
      h += '<p class="p-line">Трекер зала ещё не подключён к пульту</p>';
    } else if (!gymWeek(g, ctx.today).known) {
      h += '<p class="p-line">Трекер зала не прислал счёт недели</p>';
    } else {
      const gw = gymWeek(g, ctx.today);
      const days = gw.days;
      let strip = '<div class="p-week" role="img" aria-label="' + esc('На этой неделе ' + gw.done + ' из ' + gw.plan) + '">';
      for (let i = 0; i < 7; i++) {
        const d = addDays(gw.start, i);
        const cls = (days.indexOf(d) >= 0 ? ' p-on' : '') + (d === ctx.today ? ' p-today' : '') + (d > ctx.today ? ' p-fut' : '');
        strip += '<span class="p-wd' + cls + '"><small>' + WD[i] + '</small><b>' + dateOf(d).getDate() + '</b></span>';
      }
      strip += '</div>';
      const st = gymState(g, ctx.today);
      h += '<p class="p-line">На этой неделе <b class="' + (st === 'amber' ? 'p-amb' : '') + '">' + gw.done + ' из ' + gw.plan + '</b>' +
        (g.last ? ' · последняя тренировка' + NB + day(g.last) : '') +
        (gb.status === 'stale' ? ' <span class="p-amb">· данные с ' + (String(gb.at || '').slice(0, 10) === ctx.today ? hm(gb.at) : day(gb.at)) + '</span>' : '') + '</p>' + strip;
      /* неделя из снимка уже прошла: она встаёт в ряд прошлых, а текущая начинается с нуля */
      const all = (g.weeks || []).concat(gw.cur ? [] : [{ start: g.week.start, done: g.week.done }]).slice(-4)
        .concat([{ start: gw.start, done: gw.done, cur: true }]);
      h += '<p class="p-line p-sec">Прошлые 4 недели, план ' + gw.plan + ' в неделю</p><div class="p-weeks">' + all.map((w) => {
        const wd = w.done || 0;
        const n = Math.max(gw.plan || 0, wd);
        let st2 = '';
        for (let i = n - 1; i >= 0; i--) st2 += '<i' + (i < wd ? ' class="p-on"' : '') + '></i>';
        return '<div class="p-wk' + (w.cur ? ' p-cur' : '') + '"><b>' + wd + '</b><span class="p-stack">' + st2 + '</span>' +
          '<span class="p-sub">' + (w.cur ? 'эта' : esc(day(w.start))) + '</span></div>';
      }).join('') + '</div>';
    }
    /* здоровье: шаги за день и сон (то, что Иван просил видеть), вес только если телефон его прислал */
    const hb = B.health || {}, hd = hb.data || {};
    const hdays = (hd.days || []).filter((d) => d && d.d && d.d <= ctx.today).slice(-7);
    let hh = '';
    if (hb.status === 'empty' || !hdays.length) {
      hh += '<p class="p-calm p-health">' + lamp('none', 'не подключено') + 'Шаги и сон: iPhone ещё не прислал данные</p>';
    } else {
      const back = hdays.slice().reverse();
      const stD = back.find((d) => d.steps != null), slD = back.find((d) => d.sleep_min != null), wDay = back.find((d) => d.weight != null);
      const when = (d) => (d === ctx.today ? 'сегодня' : daysBetween(d, ctx.today) === 1 ? 'вчера' : day(d));
      const steps = hdays.map((d) => d.steps).filter((v) => v != null);
      const mx = Math.max.apply(null, steps.concat([1]));
      const bars = '<svg class="p-mini" viewBox="0 0 70 24" preserveAspectRatio="none" aria-hidden="true">' + hdays.map((d, i) =>
        d.steps == null ? '' : '<rect x="' + (i * 10 + 1) + '" y="' + (24 - d.steps / mx * 22).toFixed(1) + '" width="8" height="' + (d.steps / mx * 22).toFixed(1) + '"' +
          (stD && d.d === stD.d ? ' class="p-on"' : '') + '/>').join('') + '</svg>';
      const push = hd.last_push || '';
      const old = hb.status === 'stale' || !((Date.now() - Date.parse(push)) / 3600000 < 36);
      hh += '<div class="p-hgrid' + (wDay ? '' : ' p-two') + '">' +
        '<div class="p-mt"><span class="p-lbl">Шаги</span><b>' + (stD ? f().num(stD.steps) : 'нет') + '</b>' + bars +
          '<span class="p-sub">' + (stD ? esc(when(stD.d)) + (stD.d === ctx.today ? ', день ещё идёт' : stD.steps_part ? ', день неполный' : '') : 'в данных нет') + '</span></div>' +
        '<div class="p-mt"><span class="p-lbl">' + (slD && slD.sleep_in_bed ? 'В постели' : 'Сон') + '</span><b>' + (slD ? durH(slD.sleep_min) : 'нет') + '</b>' +
          '<span class="p-sub">' + (slD ? 'ночь на ' + esc(day(slD.d)) + (slD.sleep_in_bed ? ', сна в данных нет' : '') : 'в данных нет') + '</span></div>' +
        (wDay ? '<div class="p-mt"><span class="p-lbl">Вес</span><b>' + String(wDay.weight).replace('.', ',') + '<small>' + NB + 'кг</small></b>' +
          '<span class="p-sub">' + esc(day(wDay.d)) + '</span></div>' : '') +
      '</div><p class="p-line p-foot">' + (old ? '<span class="p-amb">телефон давно не присылал данные</span> · ' : '') +
        'прислано с iPhone ' + (push ? (push.slice(0, 10) === ctx.today ? hm(push) : esc(day(push)) + ' ' + hm(push)) : 'неизвестно когда') + '</p>';
    }
    /* телефон прислал шаги или сон: они идут первыми (плитка теперь про них), зал ниже под своим заголовком */
    return hb.status !== 'empty' && hdays.length ? hh + '<p class="p-line p-sec">Зал</p>' + h : h + hh;
  }

  function drawerMoney(S, P, ctx) {
    const mb = (S.blocks || {}).money || {}, m = mb.data || {};
    if (mb.status === 'empty' || !m.month) return '<p class="p-line">Нет данных о деньгах</p>';
    const total = m.month.sum || 0;
    const rows = (m.by || []).slice().sort((a, b) => b.month - a.month);
    const nz = rows.filter((r) => r.month > 0 || !r.ok), zero = rows.filter((r) => !(r.month > 0) && r.ok);
    const mon = MON_NOM[dateOf(m.day).getMonth()];
    let h = '<ul class="p-src">' + nz.map((r) => {
      if (r.month == null) {                       /* ни разу не ответил: суммы нет, и это не ноль */
        return '<li class="p-st-amber"><span class="p-sr"><span class="p-sn">' + esc(r.name) + '</span><b class="p-nd">нет данных</b></span>' +
          '<span class="p-sub p-amb">источник ещё ни разу не ответил</span></li>';
      }
      const share = total ? r.month / total * 100 : 0;
      const nWord = r.id === 'manual' ? plural(r.n_month, 'запись', 'записи', 'записей') : plural(r.n_month, 'оплата', 'оплаты', 'оплат');
      const bits = r.n_month != null ? [r.n_month + NB + nWord] : [];
      if (r.today) bits.push('сегодня ' + f().money(r.today));
      if (r.id === 'manual' && m.unconfirmed) bits.push('<span class="p-amb">не сверено ' + f().money(m.unconfirmed) + '</span>');
      return '<li' + (r.ok ? '' : ' class="p-st-amber"') + '>' +
        '<span class="p-sr"><span class="p-sn">' + esc(r.name) + '</span><b>' + f().money(r.month) + '</b></span>' +
        '<span class="p-sbar"><i style="width:' + Math.max(share, r.month ? 1.5 : 0).toFixed(1) + '%"></i><em>' + Math.round(share) + '%</em></span>' +
        '<span class="p-sub">' + bits.join(' · ') + '</span>' +
        (r.ok ? '' : '<span class="p-sub p-amb">не ответил в этот прогон, сумма с прошлой сверки</span>') + '</li>';
    }).join('') + '</ul>';
    if (zero.length) h += '<p class="p-line p-zero">Без оплат в ' + (mon === 'май' ? 'мае' : mon.replace(/ь$/, 'е').replace(/т$/, 'те')) + ': ' + esc(zero.map((r) => r.name).join(', ')) + '</p>';

    /* ряд за 30 дней: столбики по дням, пунктир = нужно в день */
    const d30 = m.days30 || [];
    if (d30.length) {
      const need = (m.pace || {}).need_per_day || 0;
      const mx = Math.max.apply(null, d30.map((d) => d.sum || 0).concat([need, 1])) * 1.08;
      const n = d30.length, bw = 100 / n;
      const bars = d30.map((d, i) => d.sum > 0
        ? '<rect data-p-i="' + i + '" x="' + (i * bw + 0.35).toFixed(2) + '" y="' + (100 - d.sum / mx * 100).toFixed(2) + '" width="' + (bw - 0.7).toFixed(2) + '" height="' + (d.sum / mx * 100).toFixed(2) + '"' +
          (i === n - 1 ? ' class="p-now"' : '') + '/>' : '').join('');
      const best = d30.reduce((a, d) => ((d.sum || 0) > (a.sum || 0) ? d : a), d30[0]);
      ctx.d30 = d30;
      ctx.d30def = '30 дней: <b>' + f().money(m.d30 ? m.d30.sum : d30.reduce((s, d) => s + (d.sum || 0), 0)) + '</b> · лучший день ' + esc(day(best.d)) + ', ' + f().money(best.sum);
      const ny = need ? (100 - need / mx * 100) : null;
      h += '<p class="p-line p-sec">Каждый день за 30 дней</p>' +
        '<p class="p-rd" id="p-rd" aria-live="polite">' + ctx.d30def + '</p>' +
        '<div class="p-chart" id="p-chart" role="img" aria-label="' + esc('Деньги по дням за 30 дней, ' + ctx.d30def.replace(/<[^>]+>/g, '')) + '">' +
          '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + bars + '</svg>' +
          (ny != null ? '<span class="p-ref" style="top:' + ny.toFixed(2) + '%"><em>нужно в день ' + f().money(need) + '</em></span>' : '') +
        '</div>' +
        '<div class="p-xax"><span>' + esc(day(d30[0].d)) + '</span><span>' + esc(day(d30[Math.floor(n / 2)].d)) + '</span><span>' + esc(day(d30[n - 1].d)) + '</span></div>';
    }
    h += '<p class="p-line p-foot">Деньги считаются по московской дате: сегодня по Москве ' + esc(day(m.day)) +
      (mb.status === 'stale' ? ' <span class="p-amb">· цифры с ' + hm(mb.at) + '</span>' : '') + '</p>';
    return h;
  }

  const TITLES = { main: 'Главное и автоматизации', today: 'Дела на сегодня', aud: 'Подписчики по площадкам', gym: 'Здоровье и зал', money: 'Деньги: состав и 30 дней' };
  const DRAW = { main: drawerMain, today: drawerToday, aud: drawerAud, gym: drawerGym, money: drawerMoney };

  /* ---------- сборка и поведение ---------- */
  function paintDrawer(root) {
    const st = root.__pA;
    const dr = root.querySelector('#p-drawer');
    if (!st.sel) { dr.innerHTML = ''; dr.hidden = true; }
    else {
      dr.hidden = false;
      dr.setAttribute('data-p-open', st.sel);
      dr.innerHTML = '<div class="p-dh"><h3 class="p-dt">' + TITLES[st.sel] + '</h3>' +
        '<button class="p-close" type="button" data-p-close="1">Свернуть</button></div>' +
        DRAW[st.sel](st.S, st.P, st.ctx);
      bindChart(root);
    }
    root.querySelectorAll('[data-p-tile]').forEach((b) => {
      const on = b.getAttribute('data-p-tile') === st.sel;
      if (!b.classList.contains('p-alarm')) b.classList.toggle('p-sel', on);
      b.setAttribute('aria-expanded', String(on));
      /* слово-действие следует за состоянием: «открыть площадки» / «свернуть» */
      const ta = b.querySelector('.p-ta');
      if (ta) { ta.textContent = ta.getAttribute(on ? 'data-p-tc' : 'data-p-ta'); ta.classList.toggle('p-shut', on); }
    });
  }

  /* ведёшь пальцем по столбикам - сверху показание дня */
  function bindChart(root) {
    const ch = root.querySelector('#p-chart'), rd = root.querySelector('#p-rd');
    if (!ch || !rd) return;
    const ctx = root.__pA.ctx;
    let timer = 0;
    const show = (ev) => {
      clearTimeout(timer);
      const r = ch.getBoundingClientRect();
      const i = Math.max(0, Math.min(ctx.d30.length - 1, Math.floor((ev.clientX - r.left) / r.width * ctx.d30.length)));
      const d = ctx.d30[i];
      rd.innerHTML = esc(day(d.d)) + ': <b>' + (d.sum ? f().money(d.sum) : 'оплат нет') + '</b>';
      ch.querySelectorAll('rect').forEach((x) => x.classList.toggle('p-hov', x.getAttribute('data-p-i') === String(i)));
      ch.style.setProperty('--p-x', ((i + 0.5) / ctx.d30.length * 100) + '%');
      ch.classList.add('p-scrub');
    };
    const reset = () => { rd.innerHTML = ctx.d30def; ch.classList.remove('p-scrub'); ch.querySelectorAll('.p-hov').forEach((x) => x.classList.remove('p-hov')); };
    ch.addEventListener('pointerdown', show);
    ch.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) show(ev); });
    /* палец: браузер шлёт pointerleave сразу после отрыва, поэтому показание дня держим по таймеру; мышь: сброс при уходе */
    const later = () => { clearTimeout(timer); timer = setTimeout(reset, 2500); };
    ch.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') reset(); });
    ch.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') later(); });
    ch.addEventListener('pointercancel', later);
  }

  function reveal(root) {
    const dr = root.querySelector('#p-drawer');
    if (!dr || dr.hidden) return;
    const r = dr.getBoundingClientRect();
    const want = innerHeight * 0.42;
    if (r.top > want) window.scrollTo({ top: scrollY + r.top - want, behavior: 'smooth' });
  }

  function bind(root) {
    if (root.__pBound) return;
    root.__pBound = true;
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-p-tile],[data-p-close],[data-p-grp],[data-p-income]');
      if (!t || !root.contains(t)) return;
      const st = root.__pA;
      if (t.hasAttribute('data-p-tile')) {
        const k = t.getAttribute('data-p-tile');
        st.sel = st.sel === k && !t.classList.contains('p-alarm') ? null : k;
        paintDrawer(root);
        reveal(root);
      } else if (t.hasAttribute('data-p-close')) {
        const was = root.querySelector('[data-p-tile="' + st.sel + '"]:not(.p-alarm)');
        st.sel = null; paintDrawer(root);
        if (was) was.focus({ preventScroll: true });
      } else if (t.hasAttribute('data-p-grp')) {
        const gi = +t.getAttribute('data-p-grp');
        if (st.ctx.openGroups.has(gi)) st.ctx.openGroups.delete(gi); else st.ctx.openGroups.add(gi);
        paintDrawer(root);
        const b = root.querySelector('[data-p-grp="' + gi + '"]'); if (b) b.focus({ preventScroll: true });
      } else if (t.hasAttribute('data-p-income')) openIncome();
    });
  }


  /* ---------- контент и вайб-кодинг (22.11.2026): плитки третьего ряда и их ящики ----------
     Блоки content и vibe снимка (CONTRACT.md). Время слота и поста берётся из строки снимка, как везде,
     рядом в подробностях время по Москве: сетка задана по Москве */
  const KIND1 = { carousel: 'Карусель', reel: 'Рилс', tg: 'Пост в канал' };
  const KIND_N = { carousel: ['карусель', 'карусели', 'каруселей'], reel: ['рилс', 'рилса', 'рилсов'], tg: ['пост', 'поста', 'постов'] };
  const PL = { ig: 'IG', yt: 'YT', tt: 'TT', vk: 'ВК', tg: 'TG' };
  const C_WORD = { done: 'вышло', now: 'время выкладывать', late: 'не вышло', wait: 'ещё не проверено', ahead: 'впереди', nocheck: 'не проверяется' };
  const C_LAMP = { done: 'ok', now: 'amber', late: 'amber', wait: 'none', ahead: 'none', nocheck: 'none' };
  const mskHm = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t + 3 * 3600000).toISOString().slice(11, 16); };
  const kn = (k, n) => { const w = KIND_N[k] || KIND_N.tg; return n + NB + plural(n, w[0], w[1], w[2]); };
  const slotName = (s) => KIND1[s.kind] + (s.kind === 'tg' ? '' : NB + s.n);

  /* «не вышло: 2 рилса, 1 карусель» */
  function lateText(late) {
    const by = {};
    late.forEach((s) => { by[s.kind] = (by[s.kind] || 0) + 1; });
    return 'не вышло: ' + Object.keys(by).map((k) => kn(k, by[k])).join(', ');
  }

  function tileContent(S) {
    const cb = (S.blocks || {}).content || {}, c = cb.data || {};
    if (cb.status === 'empty' || !c.slots) {
      return tile('cnt', 'Контент', lamp('none', 'нет данных'), 'нет', 'план выкладки не подключён', 'none', 'p-c-mut', 'открыть план дня');
    }
    const late = c.slots.filter((s) => s.state === 'late');
    const old = cb.status === 'stale';
    const cnt = lamp(late.length || old ? 'amber' : 'ok', old ? 'данные старые' : late.length ? 'есть невышедшее' : 'идёт по плану');
    let ln;
    if (c.next) ln = 'дальше <b>' + hm(c.next.at) + '</b> ' + esc(slotName(c.next).toLowerCase());
    else ln = c.done >= c.total ? 'план дня выполнен' : 'слотов на сегодня больше нет';
    if (late.length) ln += '<span class="p-amb p-blk">' + esc(lateText(late)) + '</span>';
    if (old) ln += '<span class="p-amb p-blk">данные с' + NB + hm(cb.at) + '</span>';
    return tile('cnt', 'Контент', cnt, c.done + '<small>/' + c.total + '</small>', ln, late.length || old ? 'amber' : 'ok', '', 'открыть план дня');
  }

  function drawerContent(S) {
    const cb = (S.blocks || {}).content || {}, c = cb.data || {};
    if (cb.status === 'empty' || !c.slots) return '<p class="p-line">План выкладки ещё не подключён к пульту</p>';
    let h = '<p class="p-line">Выложено <b>' + c.done + ' из ' + c.total + '</b> · день по Москве ' + esc(day(c.day)) +
      (cb.status === 'stale' ? ' <span class="p-amb">· данные с ' + hm(cb.at) + '</span>' : '') + '</p>';
    h += '<div class="p-kinds">' + (c.kinds || []).map((k) => '<span class="p-kind' + (k.count && k.done >= k.count ? ' p-full' : '') + '">' +
      '<b>' + k.done + '<small>/' + k.count + '</small></b>' + esc(k.name) + (k.extra ? ' <em>+' + k.extra + NB + 'сверх</em>' : '') + '</span>').join('') + '</div>';
    const nx = c.next ? c.slots.findIndex((s) => s.at === c.next.at && s.kind === c.next.kind && s.n === c.next.n) : -1;
    h += '<ul class="p-slots">' + c.slots.map((s, i) => {
      const main = s.where[0] || {};
      const word = main.state === 'done' && main.t ? 'вышло ' + hm(main.t) : C_WORD[s.state] || '';
      const pls = s.where.length > 1 ? '<span class="p-pls">' + s.where.map((w) => '<span class="p-pl p-pl-' + w.state + '" title="' +
        esc(PL[w.p] + ': ' + (w.state === 'done' && w.t ? 'вышло ' + hm(w.t) : C_WORD[w.state])) + '">' + esc(PL[w.p] || w.p) + '</span>').join('') + '</span>' : '';
      return '<li class="p-sl p-sl-' + s.state + (i === nx ? ' p-next' : '') + '">' +
        '<span class="p-slt"><b>' + hm(s.at) + '</b><small>' + mskHm(s.at) + NB + 'мск</small></span>' +
        '<span class="p-sln">' + esc(slotName(s)) + pls + '</span>' +
        '<span class="p-slw">' + lamp(C_LAMP[s.state] || 'none', C_WORD[s.state] || '') + esc(word) + '</span></li>';
    }).join('') + '</ul>';
    const src = c.sources || [];
    const on = src.filter((x) => x.state !== 'off'), off = src.filter((x) => x.state === 'off');
    h += '<p class="p-line p-foot">Проверено: ' + on.map((x) => esc(x.name) + ' ' + (x.state === 'stale'
      ? '<span class="p-amb">молчит' + (x.at ? ' с' + NB + hm(x.at) : '') + '</span>' : x.at ? hm(x.at) : 'ещё нет')).join(', ') +
      (off.length ? '. ' + esc(off.map((x) => x.name).join(' и ')) + ' пока не проверяются: подключатся вместе с Postmypost' : '') +
      '. Instagram платный, его смотрим раз в 2 часа, когда подошло время слота</p>';
    const wk = c.week || [];
    if (wk.length) {
      h += '<p class="p-line p-sec">Последние 7 дней</p><div class="p-cweek">' + wk.map((d) => {
        const p = d.done == null || !d.total ? 0 : Math.round(d.done / d.total * 100);
        return '<div class="p-cw' + (d.d === c.day ? ' p-cur' : '') + (d.done == null ? ' p-nod' : '') + '"><b>' + (d.done == null ? '·' : d.done) + '</b>' +
          '<span class="p-cbar"><i style="height:' + p + '%"></i></span><span class="p-sub">' + WD[(dateOf(d.d).getDay() + 6) % 7] + '</span></div>';
      }).join('') + '</div>';
      if (wk.some((d) => d.done == null)) h += '<p class="p-line p-foot">Счёт идёт с ' + esc(day(c.since)) + ': Instagram отдаёт только последние 12 постов, раньше этого дня полного счёта нет</p>';
    }
    return h + '<p class="p-line p-foot">Норма и время слотов задаются в настройке Пульта. Поменять: скажи Claude, например «карусели с 14:00 каждые 30 минут»</p>';
  }

  /* ---------- вайб-кодинг ---------- */
  const pctTxt = (p) => (p.pct == null ? 'без пунктов' : p.done + ' из ' + p.total);

  function tileVibe(S) {
    const vb = (S.blocks || {}).vibe || {}, v = vb.data || {};
    if (vb.status === 'empty' || !v.today) {
      return tile('vibe', 'Вайб-кодинг', lamp('none', 'нет данных'), 'нет', 'планы не подключены', 'none', 'p-c-mut', 'открыть проекты');
    }
    const t = v.today, top = (t.items || [])[0], n = (v.counts || {}).active || 0;
    const ind = vb.status === 'stale' ? lamp('amber', 'данные старые') : '';
    let ln = top ? '<span class="p-clamp">' + esc(top.title) + (top.pct != null ? ' · <b>' + top.pct + '%</b>' : '') + '</span>' : 'сегодня правок не было';
    ln += '<span class="p-blk">в работе ' + n + NB + plural(n, 'проект', 'проекта', 'проектов') + '</span>';
    if (vb.status === 'stale') ln += '<span class="p-amb p-blk">данные с' + NB + hm(vb.at) + '</span>';
    return tile('vibe', 'Вайб-кодинг', ind, t.min ? durH(t.min) : '0<small>' + NB + 'мин</small>', ln,
      vb.status === 'stale' ? 'amber' : 'info', t.min >= 600 ? 'p-long p-dur' : 'p-dur', 'открыть проекты');
  }

  function projRow(p, meta) {
    const w = p.pct == null ? 0 : Math.max(p.pct, p.pct ? 1.5 : 0);
    return '<li><span class="p-sr"><span class="p-sn">' + esc(p.title) + '</span><b>' + (p.pct == null ? '<span class="p-nd">без пунктов</span>' : p.pct + '%') + '</b></span>' +
      '<span class="p-sbar"><i style="width:' + w + '%"></i><em>' + esc(pctTxt(p)) + '</em></span>' +
      '<span class="p-sub">' + meta + '</span>' + (p.next ? '<span class="p-sub p-nxt">дальше: ' + esc(p.next) + '</span>' : '') + '</li>';
  }

  function drawerVibe(S) {
    const vb = (S.blocks || {}).vibe || {}, v = vb.data || {};
    if (vb.status === 'empty' || !v.today) return '<p class="p-line">Планы и время ещё не подключены к пульту</p>';
    const t = v.today, cn = v.counts || {};
    let h = '<p class="p-line">Сегодня <b>' + durS(t.min || 0) + '</b>, из них по планам ' + durS(t.plan_min || 0) +
      ' · всего в Claude ' + durS(t.all_min || 0) + (vb.status === 'stale' ? ' <span class="p-amb">· данные с ' + hm(vb.at) + '</span>' : '') + '</p>';
    if ((t.items || []).length) {
      h += '<p class="p-line p-sec">Сегодня по проектам</p><ul class="p-src p-proj">' + t.items.map((p) => projRow(p,
        (p.min_today ? durS(p.min_today) + ' сегодня' : 'сегодня без времени') + (p.closed_today ? ' · закрыто пунктов: ' + p.closed_today : ''))).join('') + '</ul>';
    }
    if ((t.free || []).length) {
      h += '<p class="p-line p-sec">Правки без плана</p><ul class="p-wait">' + t.free.map((x) =>
        '<li><span>' + esc(x.title) + '</span><b>' + durS(x.min) + '</b></li>').join('') + '</ul>';
    }
    const d14 = v.days14 || [];
    if (d14.length) {
      const mx = Math.max.apply(null, d14.map((d) => d.min).concat([60]));
      const bw = 100 / d14.length;
      const sum7 = d14.slice(-7).reduce((s, d) => s + d.min, 0);
      h += '<p class="p-line p-sec">14 дней · за неделю ' + durS(sum7) + '</p><div class="p-chart p-vchart" role="img" aria-label="' +
        esc('Вайб-кодинг по дням за 14 дней, за неделю ' + durS(sum7).split(NB).join(' ')) + '"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        d14.map((d, i) => d.min ? '<rect x="' + (i * bw + 0.8).toFixed(2) + '" y="' + (100 - d.min / mx * 100).toFixed(2) + '" width="' + (bw - 1.6).toFixed(2) +
          '" height="' + (d.min / mx * 100).toFixed(2) + '"' + (i === d14.length - 1 ? ' class="p-now"' : '') + '/>' : '').join('') + '</svg></div>' +
        '<div class="p-xax"><span>' + esc(day(d14[0].d)) + '</span><span>' + esc(day(d14[7].d)) + '</span><span>' + esc(day(d14[d14.length - 1].d)) + '</span></div>';
    }
    if ((v.active || []).length) {
      h += '<p class="p-line p-sec">В работе · ' + (cn.active || v.active.length) + '</p><ul class="p-src p-proj">' + v.active.map((p) => projRow(p,
        (p.min7 ? 'за 7 дней ' + durS(p.min7) : 'за 7 дней без времени') + ' · движение ' + esc(day(p.last)))).join('') + '</ul>';
    }
    if ((v.waiting || []).length) {
      h += '<p class="p-line p-sec">Ждут в планах · ' + (cn.waiting || v.waiting.length) + '</p><ul class="p-wait">' + v.waiting.map((p) =>
        '<li><span>' + esc(p.title) + '<small>не трогали с ' + esc(day(p.last)) + '</small></span><b>' + (p.pct == null ? '-' : p.pct + '%') + '</b></li>').join('') + '</ul>';
    }
    if ((v.done || []).length) h += '<p class="p-line p-sec">Готово за 2 недели</p><p class="p-line">' + esc(v.done.map((p) => p.title).join(' · ')) + '</p>';
    return h + '<p class="p-line p-foot">Проект = файл плана в IvanOS/plans, процент = закрытые пункты. Время считается по сессиям Claude рядом с правками файлов, ' +
      'два окна сразу идут один раз, день по Москве</p>';
  }

  TITLES.cnt = 'Контент на сегодня';
  TITLES.vibe = 'Вайб-кодинг';
  DRAW.cnt = drawerContent;
  DRAW.vibe = drawerVibe;

  /* ---------- заявки (22.11.2026): широкая плитка третьим рядом и её ящик ----------
     Блок leads снимка (CONTRACT.md): пришло, обработано, ждут ответа, молчат, дожать. Пульт никому не пишет,
     ссылка в строке открывает диалог в Telegram или директе */
  const L_CH = { tg: 'Telegram', ig: 'директ' };
  const L_CAT = { lead: 'лид', student: 'ученик', personal: 'личное', customer: 'клиент', other: 'другое', closure: 'закрыто', new: 'новый', spam: 'спам' };
  const daysW = (n) => n + NB + plural(n, 'день', 'дня', 'дней');
  /* «сегодня 14:05», «вчера 22:10», «20 ноя» */
  function whenS(iso, today) {
    if (!iso) return 'давно в очереди';
    const d = iso.slice(0, 10);
    if (d === today) return 'с ' + hm(iso);
    return daysBetween(d, today) === 1 ? 'со вчера ' + hm(iso) : 'с ' + day(d);
  }

  function tileLeads(S) {
    const lb = (S.blocks || {}).leads || {}, l = lb.data || {};
    const key = 'leads', act = 'открыть заявки';
    if (lb.status === 'empty' || !l.tg) return tile(key, 'Заявки', lamp('none', 'нет данных'), 'нет', 'журналы ответчиков не подключены', 'none', 'p-c-mut', act);
    const c = l.counts || {}, tg = l.tg || {}, ig = l.ig || {};
    const came = (tg.today || 0) + (ig.today || 0);
    const old = lb.status === 'stale';
    const warn = (c.waiting || 0) > 0 || old;
    const cell = (n, lbl, sub, cls) => '<span class="p-lc' + (cls ? ' ' + cls : '') + '"><b>' + n + '</b><span class="p-ll">' + lbl + '</span><span class="p-ls">' + sub + '</span></span>';
    return '<button class="p-tile p-wide p-st-' + (warn ? 'amber' : 'ok') + '" type="button" data-p-tile="' + key + '" aria-expanded="false" aria-controls="p-drawer">' +
      '<span class="p-th"><span class="p-lbl">Заявки</span>' + lamp(warn ? 'amber' : 'ok', warn ? 'есть ждущие ответа' : 'все отвечены') + '</span>' +
      '<span class="p-lcells">' +
        cell(came, 'написали', 'TG ' + (tg.today || 0) + ' · директ ' + (ig.today || 0)) +
        cell(c.waiting || 0, 'ждут ответа', c.waiting ? 'от тебя' : 'никто', c.waiting ? 'p-c-amb' : '') +
        cell(c.push || 0, 'дожать', 'молчат ' + (c.silent || 0)) +
      '</span>' + (old ? '<span class="p-tl p-amb">данные с' + NB + hm(lb.at) + '</span>' : '') +
      '<span class="p-ta" data-p-ta="' + act + '" data-p-tc="свернуть">' + act + '</span></button>';
  }

  function personRow(p, today, right) {
    const tagCh = '<span class="p-lt">' + esc(L_CH[p.ch] || p.ch) + '</span>';
    const inner = '<span class="p-lp"><b>' + esc(p.name) + '</b>' + tagCh + (p.user ? '<small>@' + esc(p.user) + '</small>' : '') + '</span>' +
      '<span class="p-lr">' + right + '</span>' + (p.what ? '<span class="p-sub">' + esc(p.what) + '</span>' : '');
    return p.link ? '<li><a class="p-lrow" href="' + esc(p.link) + '" target="_blank" rel="noopener">' + inner + '</a></li>'
      : '<li><span class="p-lrow">' + inner + '</span></li>';
  }

  function chLine(name, s) {
    const a = s.acts || {}, cats = s.cats || {};
    const ca = Object.keys(cats).sort((x, y) => cats[y] - cats[x]).map((k) => (L_CAT[k] || k) + ' ' + cats[k]).join(', ');
    return '<li><span class="p-sr"><span class="p-sn">' + name + '</span><b>' + (s.today || 0) + '<small>' + NB + plural(s.today || 0, 'человек', 'человека', 'человек') + '</small></b></span>' +
      '<span class="p-sub">обращений ' + (s.msgs || 0) + ': ответчик ответил ' + (a.reply || 0) + ', передано тебе ' + (a.escalate || 0) + ', ответ не нужен ' + (a.skip || 0) + '</span>' +
      (ca ? '<span class="p-sub">кто: ' + esc(ca) + '</span>' : '') + '<span class="p-sub">за 7 дней ' + (s.d7 || 0) + NB + plural(s.d7 || 0, 'человек', 'человека', 'человек') + '</span></li>';
  }

  function drawerLeads(S) {
    const lb = (S.blocks || {}).leads || {}, l = lb.data || {};
    if (lb.status === 'empty' || !l.tg) return '<p class="p-line">Журналы ответчиков ещё не подключены к пульту</p>';
    const c = l.counts || {}, today = l.day, sc = l.scan || {};
    const ref = String(S.updated || '').slice(0, 10) || today;       /* «с 00:44» считаем от даты снимка по времени Мака, не от московской */
    let h = '<p class="p-line">Сегодня по Москве написали <b>' + ((l.tg.today || 0) + (l.ig.today || 0)) + '</b>: Telegram ' + (l.tg.today || 0) + ', директ ' + (l.ig.today || 0) +
      (lb.status === 'stale' ? ' <span class="p-amb">· данные с ' + hm(lb.at) + '</span>' : '') + '</p>';
    h += '<ul class="p-src p-lch">' + chLine('Telegram', l.tg) + chLine('Директ', l.ig) + '</ul>';
    const dd = (l.tg.days || []).map((d, i) => ({ d: d.d, tg: d.n, ig: ((l.ig.days || [])[i] || {}).n || 0 }));
    if (dd.length) {
      const mx = Math.max.apply(null, dd.map((d) => d.tg + d.ig).concat([1]));
      h += '<div class="p-cweek p-lweek">' + dd.map((d) => '<div class="p-cw' + (d.d === today ? ' p-cur' : '') + '"><b>' + (d.tg + d.ig) + '</b>' +
        '<span class="p-cbar"><i class="p-ig" style="height:' + Math.round((d.tg + d.ig) / mx * 100) + '%"></i><i style="height:' + Math.round(d.tg / mx * 100) + '%"></i></span>' +
        '<span class="p-sub">' + WD[(dateOf(d.d).getDay() + 6) % 7] + '</span></div>').join('') + '</div>' +
        '<p class="p-line p-foot"><i class="p-key"></i>Telegram <i class="p-key p-ig"></i>директ, людей за день</p>';
    }
    const w = l.waiting || [];
    h += '<p class="p-line p-sec">Ждут ответа · ' + (c.waiting || 0) + '</p>';
    h += w.length ? '<ul class="p-lpl">' + w.map((p) => personRow(p, ref, '<em class="p-amb">' + esc(p.why) + '</em><small>' + esc(whenS(p.since, ref)) + '</small>')).join('') + '</ul>'
      : '<p class="p-line">Никто не ждёт</p>';
    if (c.personal_wait) h += '<p class="p-line p-foot">Ещё ' + c.personal_wait + ' в личных переписках, в список не включены</p>';
    const pu = l.push || [];
    h += '<p class="p-line p-sec">Дожать · ' + (c.push || 0) + '</p><p class="p-line p-foot">Получили цены и молчат от 2 до 21 дня. Пульт никому не пишет: пишешь сам или говоришь Claude, кого дожать</p>';
    if (pu.length) h += '<ul class="p-lpl">' + pu.map((p) => personRow(p, ref, '<em>молчит ' + daysW(p.days) + '</em>')).join('') + '</ul>';
    if ((c.push || 0) > pu.length) h += '<p class="p-line p-foot">Показаны ' + pu.length + ' самых свежих из ' + c.push + '</p>';
    const si = (l.silent || []).filter((p) => !pu.some((q) => q.link === p.link)).slice(0, 15);
    if (si.length) {
      h += '<p class="p-line p-sec">Молчат после ответа · ' + (c.silent || 0) + '</p><ul class="p-wait">' + si.map((p) =>
        '<li><span>' + esc(p.name) + '<small>' + (p.priced ? 'цены получил' : 'цены не получал') + (p.user ? ' · @' + esc(p.user) : '') + '</small></span><b>' + daysW(p.days) + '</b></li>').join('') + '</ul>';
    }
    return h + '<p class="p-line p-foot">' + (sc.fresh ? 'Переписка Telegram сверена в ' + hm(sc.at) : '<span class="p-amb">Переписка Telegram не сверена' +
      (sc.at ? ' с ' + hm(sc.at) : '') + ': «ждут» и «молчат» по журналу ответчика</span>') +
      '. Директ по журналу ответчика: твой ответ руками в директе Пульт не видит</p>';
  }

  TITLES.leads = 'Заявки';
  DRAW.leads = drawerLeads;
  /* ---------- отрисовка вида: состояние ящика переживает перерисовку ---------- */
  const UI = { touched: false, sel: null, groups: null, sig: '' };

  function paint(root, S, P) {
    const ctx = { today: todayYmd(P), nowMin: nowMinutes(P, S), openGroups: new Set() };
    ctx.ag = agenda(P, ctx.nowMin);
    const md = (((S.blocks || {}).machines || {}).data) || {};
    if (UI.touched && UI.groups) UI.groups.forEach((i) => ctx.openGroups.add(i));
    else (md.groups || []).forEach((g, i) => { if (g.items.some((it) => it.state !== 'ok')) ctx.openGroups.add(i); });
    const att = S.attention || [];
    /* пока Иван сам ничего не открывал, открыт главный повод: сигналы, а без них дела дня */
    const sel = UI.touched ? UI.sel : (att.length ? 'main' : 'today');
    root.__pA = { S, P, ctx, opts: {}, sel };
    root.classList.add('p-a');
    root.innerHTML =
      (S._test ? '<p class="p-test"><b>Пример</b> · ' + esc(S._test) + '</p>' : '') +
      alarm(S) + moneyCard(S.blocks || {}) + tiles(S, P, ctx) +
      '<section class="p-drawer" id="p-drawer" hidden></section>';
    paintDrawer(root);
    bind(root);
    if (!root.__pTouch) {
      root.__pTouch = true;
      /* после любого нажатия внутри вкладки выбор Ивана важнее выбора по умолчанию */
      root.addEventListener('click', (ev) => {
        const st = root.__pA;
        if (!st || !ev.target.closest('[data-p-tile],[data-p-close],[data-p-grp]')) return;
        UI.touched = true; UI.sel = st.sel; UI.groups = new Set(st.ctx.openGroups);
      });
    }
  }

  /* дела дня в том виде, в каком их ждёт вид: с учётом отметок, которые ещё летят к боту */
  function planerDay() {
    const t = localToday();
    let list = [], load = 0;
    try { const day = dayObj(t); list = entries(day); load = (day && day.load) || 0; } catch (e) { list = []; }
    return { today: t, entries: list, load, done_today: list.filter((e) => e.done).length, total_today: list.length };
  }

  let SNAP = null;                     /* последний снимок сборщика */
  /* wait: запрос в пути · ok: ящик ответил · cache: связи нет, показан снимок из памяти · none: связи нет и снимка нет ·
     nosnap: ящик пуст, сборщик ещё не присылал · bad: ящик ответил, но снимок не прочитался */
  let NET = 'wait';
  let lastTry = 0;

  const emptyBox = (title, text) => '<div class="empty"><b>' + title + '</b>' + text + '</div>';

  function renderPult() {
    const root = document.getElementById('v-pult');
    if (!root) return;
    if (Date.now() - lastTry > 60000) loadPult();
    if (!SNAP) {
      UI.sig = '';
      root.innerHTML = NET === 'none'
        ? emptyBox('Пульт пока пуст', 'Нет связи с ящиком, а в памяти телефона снимка ещё нет. Цифры появятся, как только вернётся сеть')
        : NET === 'nosnap'
          ? emptyBox('Пульт пока пуст', 'Сборщик на Маке ещё не прислал ни одного снимка. Он работает раз в 15 минут, цифры появятся сами')
          : NET === 'bad'
            ? emptyBox('Снимок не прочитался', 'Ящик ответил, но снимок не расшифровался. Остальные вкладки работают. Покажи этот экран Claude')
            : '<div class="skel"></div>';
      return;
    }
    const P = planerDay();
    /* перерисовка только когда что-то изменилось: снимок, дела (в том числе отметка или перенос, которые ещё
       летят к боту) или прошло пять минут */
    const sig = [SNAP.updated, DATA && DATA.updated, Math.floor(Date.now() / 300000),
      P.entries.map((e) => (e.id || '') + ':' + e.s + ':' + (e.done ? 1 : 0)).join(',')].join('|');
    if (sig === UI.sig && root.firstChild) return;
    UI.sig = sig;
    try { paint(root, SNAP, P); } catch (e) {
      UI.sig = '';
      /* причина мелкой строкой: Иван покажет экран, и по ней видно, что чинить */
      root.innerHTML = emptyBox('Пульт не нарисовался', 'Остальные вкладки работают. Покажи этот экран Claude, он починит' +
        '<span class="p-sub p-blk p-why">' + esc(e && e.message ? e.message : String(e)) + '</span>');
      if (window.console) console.error(e);
    }
  }

  /* ---------- запись дохода: шторка самого планера, команда уходит боту тем же путём, что новое дело ---------- */
  /* день денег московский и считается от часов телефона: день из снимка бывает вчерашним (снимок из памяти, ночь),
     и тогда в шторке стоял бы один день, а бот записал бы другой */
  function mskToday() {
    const m = new Date(Date.now() + (new Date().getTimezoneOffset() + 180) * 60000);
    return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0');
  }
  /* Бот узнаёт команду «/доход СУММА ₽ что это ГГГГ-ММ-ДД» (planer/income_cmd.py), пишет строку в тетрадь доходов,
     отвечает в чате и запускает сборщик вне очереди. Здесь только сбор полей и отправка: сумма на вкладке меняется
     не сразу, а с новым снимком, поэтому «записано» говорит бот, а не эта шторка */
  function openIncome() {
    const today = mskToday();
    openSheet('<h3>Записать доход</h3>' +
      '<label class="fl" for="pIncSum">Сумма, ₽</label><input class="inp" id="pIncSum" inputmode="numeric" autocomplete="off" placeholder="20 000">' +
      '<label class="p-ret"><input type="checkbox" id="pIncRet"><span>это возврат, вычесть из дохода</span></label>' +
      '<label class="fl" for="pIncWhat">Что это</label><input class="inp" id="pIncWhat" autocomplete="off" maxlength="80" placeholder="флагман, перевод СБП">' +
      '<label class="fl" for="pIncDay">День по Москве</label><input class="inp" id="pIncDay" type="date" value="' + esc(today) + '" max="' + esc(today) + '">' +
      '<div class="acts"><button class="btn pri" type="button" data-p-inc="go">Записать</button></div>' +
      '<div class="hint">Запись ляжет в тетрадь доходов, бот подтвердит её в чате. Имена учеников не указывай</div>');
    const box = document.getElementById('sheetIn');
    let sent = false;                 /* одна шторка = одна запись: второй Enter и двойное нажатие повтор не шлют */
    const go = () => {
      if (sent) return;
      const raw = box.querySelector('#pIncSum').value.replace(/[\s₽]/g, '');
      if (!/^\d{1,8}$/.test(raw) || +raw === 0) return toast('Сумма цифрами, например 20000');
      const day = box.querySelector('#pIncDay').value || today;
      if (day > mskToday()) return toast('День не позже сегодняшнего по Москве');
      const what = box.querySelector('#pIncWhat').value.replace(/\s+/g, ' ').trim();
      const sign = box.querySelector('#pIncRet').checked ? '-' : '';
      sent = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      closeSheet();
      /* знак ₽ после суммы и день в конце стоят всегда: бот не спутает сумму с числом в описании,
         а дату в описании с днём записи */
      send({ op: 'say', text: '/доход ' + sign + String(+raw) + ' ₽' + (what ? ' ' + what : '') + ' ' + day });
      toast(sign ? 'Передаю боту возврат, он подтвердит в чате' : 'Передаю боту, он подтвердит запись в чате');
      /* бот запишет строку и запустит сборщик: забираем новый снимок, не дожидаясь обычной минуты */
      [15000, 35000, 70000].forEach((ms) => setTimeout(loadPult, ms));
    };
    box.querySelector('[data-p-inc="go"]').addEventListener('click', go);
    box.querySelectorAll('input:not([type="checkbox"])').forEach((el) => el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); }));
    setTimeout(() => { const el = document.getElementById('pIncSum'); if (el) el.focus(); }, 250);
  }

  /* ---------- снимок: ящик planer-relay, запасной вариант - память телефона ---------- */
  function onPult() { return typeof VIEW !== 'undefined' && VIEW === 'pult'; }
  function repaint() { if (onPult() && DATA) render(); }
  /* снимку верим, только если у него читается время и есть блоки: битый не должен ни показаться, ни застрять в памяти */
  const goodSnap = (x) => !!x && typeof x.blocks === 'object' && x.blocks !== null && isFinite(Date.parse(x.updated));

  let busy = null;
  function loadPult() { if (!busy) busy = doLoadPult().finally(() => { busy = null; }); return busy; }
  async function doLoadPult() {
    lastTry = Date.now();
    const pass = password();
    if (!pass) return;                                     /* без ключа планер сам покажет замок */
    if (!SNAP) {
      const c = store.get('pult');
      if (goodSnap(c)) { SNAP = c; repaint(); }            /* NET остаётся wait: запрос ещё в пути, «нет связи» говорить рано */
    }
    let step = 'net';
    try {
      const blob = await fetchBlob(RELAY + '/pult?t=' + Date.now(), 8000);
      step = 'read';
      const snap = await decrypt(blob, pass);
      if (!goodSnap(snap)) throw new Error('снимок без полей');
      if (!SNAP || Date.parse(snap.updated) >= Date.parse(SNAP.updated)) { SNAP = snap; store.set('pult', snap); }
      NET = 'ok';
    } catch (e) {
      /* любая неудача = показываем то, что есть, без замка и окон, но причину называем как есть:
         ящик пуст (сборщик ещё не присылал), снимок не прочитался (ключ или формат), иначе нет связи */
      if (step === 'read') NET = 'bad';
      else if (/HTTP 404/.test(String(e && e.message))) NET = 'nosnap';
      else NET = SNAP ? 'cache' : 'none';
    }
    repaint();
  }

  /* строка под шапкой, пока открыт Пульт: когда собран снимок и можно ли ему верить */
  const MON3S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function stamp(iso) {
    const d = new Date(iso), n = new Date();
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return same ? t : d.getDate() + NB + MON3S[d.getMonth()] + ' ' + t;
  }
  const NO_SNAP = { none: 'нет связи, снимка пульта ещё нет', nosnap: 'сборщик ещё не прислал снимок', bad: 'снимок пульта не прочитался' };
  function pultSync() {
    if (!SNAP) return { text: NO_SNAP[NET] || 'загружаю пульт…', stale: !!NO_SNAP[NET] };
    const at = stamp(SNAP.updated);
    if (NET === 'wait') return { text: 'снимок от ' + at + ', обновляю…', stale: false };
    if (NET === 'cache') return { text: 'нет связи, снимок от ' + at, stale: true };
    if (NET === 'nosnap' || NET === 'bad') return { text: 'свежий снимок не пришёл, показан от ' + at, stale: true };
    const old = !((Date.now() - Date.parse(SNAP.updated)) / 60000 < STALE_MIN);
    return { text: (old ? 'пульт давно не обновлялся, снимок от ' : 'пульт обновлён ') + at, stale: old };
  }

  window.renderPult = renderPult;
  window.loadPult = loadPult;
  window.pultSync = pultSync;

  loadPult();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && onPult()) loadPult(); });
  setInterval(() => { if (!document.hidden && onPult()) loadPult(); }, 60000);
})();
