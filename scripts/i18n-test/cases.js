// Exercise the real src/lib/i18n.ts logic. The Russian plural rule is the part
// most likely to be silently wrong, and "5 тренера" is the kind of mistake a
// Russian speaker notices in the first minute.
const i18n = require('./i18n.js');

let pass = 0,
  fail = 0;

function eq(got, want, label) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  }
}

i18n.registerDict('ru', {
  'Məşqə başla': 'Начать тренировку',
  '{n} müəllim izlənilir': {
    one: 'Вы подписаны на {n} тренера',
    few: 'Вы подписаны на {n} тренеров',
    many: 'Вы подписаны на {n} тренеров',
    other: 'Вы подписаны на {n} тренеров',
  },
  '{n} gün': { one: '{n} день', few: '{n} дня', many: '{n} дней', other: '{n} дней' },
});
i18n.registerDict('en', {
  'Məşqə başla': 'Start workout',
  '{n} gün': { one: '{n} day', other: '{n} days' },
});

console.log('azerbaijani (no dictionary: the source comes back)');
i18n.applyLang('az');
eq(i18n.t('Məşqə başla'), 'Məşqə başla', 'az falls back to source');
eq(i18n.t('{n} gün', { n: 5, count: 5 }), '5 gün', 'az has one form after a numeral');
eq(i18n.t('Heç bir dildə olmayan cümlə'), 'Heç bir dildə olmayan cümlə', 'untranslated string');

console.log('russian plurals');
i18n.applyLang('ru');
const ru = (n) => i18n.t('{n} gün', { n, count: n });
eq(ru(1), '1 день', '1 -> one');
eq(ru(2), '2 дня', '2 -> few');
eq(ru(4), '4 дня', '4 -> few');
eq(ru(5), '5 дней', '5 -> many');
eq(ru(11), '11 дней', '11 -> many (not one)');
eq(ru(12), '12 дней', '12 -> many (not few)');
eq(ru(14), '14 дней', '14 -> many');
eq(ru(21), '21 день', '21 -> one');
eq(ru(22), '22 дня', '22 -> few');
eq(ru(25), '25 дней', '25 -> many');
eq(ru(101), '101 день', '101 -> one');
eq(ru(111), '111 дней', '111 -> many');
eq(ru(0), '0 дней', '0 -> many');

console.log('english plurals');
i18n.applyLang('en');
eq(i18n.t('{n} gün', { n: 1, count: 1 }), '1 day', 'en singular');
eq(i18n.t('{n} gün', { n: 2, count: 2 }), '2 days', 'en plural');
eq(i18n.t('{n} gün', { n: 0, count: 0 }), '0 days', 'en zero is plural');
eq(i18n.t('Məşqə başla'), 'Start workout', 'en simple string');

console.log('placeholders');
i18n.applyLang('az');
eq(i18n.t('{a} / {b} gün', { a: 2, b: 5 }), '2 / 5 gün', 'two placeholders');
eq(i18n.t('{missing} var'), '{missing} var', 'an unfilled placeholder is left visible, not blanked');
eq(i18n.t('{n} var', { n: 0 }), '0 var', 'zero is not treated as absent');

console.log('partial translation: a half-finished dictionary still renders sentences');
i18n.applyLang('ru');
eq(i18n.t('{n} müəllim izlənilir', { n: 3, count: 3 }), 'Вы подписаны на 3 тренеров', 'ru counted noun');
eq(i18n.t('Tərcüməsi olmayan {x}', { x: 'söz' }), 'Tərcüməsi olmayan söz', 'missing ru -> az with vars filled');

console.log('hasTranslation');
eq(i18n.hasTranslation('Məşqə başla'), true, 'known key');
eq(i18n.hasTranslation('Olmayan'), false, 'unknown key');

console.log('subscription fires on change');
let fired = 0;
const off = i18n.subscribeLang(() => fired++);
i18n.applyLang('en');
i18n.applyLang('en'); // same value: must not fire again
i18n.applyLang('az');
off();
i18n.applyLang('ru');
eq(fired, 2, 'fires once per real change, never for a no-op, never after unsubscribe');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
