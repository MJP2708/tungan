/**
 * Avatar initials that read correctly for Thai and Latin names.
 *
 * The old version took `name[0]` of each word, which split emoji in half
 * (เมย์ 🌸 → "เ�") and picked Thai leading vowels as initials
 * (ศุภวัฒน์ เจริญ… → "ศเ"). Thai initials are the first consonant of the
 * first word; Latin names get two letters. Emoji and symbols are skipped.
 */
const THAI_LEADING_VOWELS = /[เแโใไ]/;
const THAI_CONSONANT = /[ก-ฮ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const ANY_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';

  const firstThai = [...words[0]].find((c) => THAI_CONSONANT.test(c) && !THAI_LEADING_VOWELS.test(c));
  if (firstThai) return firstThai;

  const latin = words
    .map((w) => [...w].find((c) => LATIN_LETTER.test(c)))
    .filter((c): c is string => !!c);
  if (latin.length) return latin.slice(0, 2).join('').toUpperCase();

  // Anything else (digits, other scripts): its first real character.
  const any = [...words.join('')].find((c) => ANY_LETTER_OR_DIGIT.test(c));
  return any ?? '?';
}
