/* data/species-groups.ts — folds the ~85 bird families into a short list of
 * broad, birder-familiar groups for the species tab's "קיבוץ כללי" mode.
 * Order of GENERAL_GROUPS is roughly taxonomic and is the display order. */

export const NO_GROUP = 'ללא קיבוץ';

export const GENERAL_GROUPS: readonly { name: string; families: readonly string[] }[] = [
  { name: 'ברווזים ואווזים', families: ['ברווזים'] },
  { name: 'עופות קרקע', families: ['פסיוניים', 'חובתיים', 'קטיים'] },
  { name: 'יונים, קוקיות ותוכים', families: ['יוניים', 'קוקייתיים', 'תוכיים', 'דרראים'] },
  { name: 'תחמסים וסיסים', families: ['תחמסיים', 'סיסיים'] },
  { name: 'עופות מים', families: ['רליתיים', 'עגוריים', 'טבלניים', 'צוללניים', 'פלמינגויים'] },
  { name: 'חופמאים', families: ['כרווניים', 'שלצדפיים', 'סייפניים', 'חופמיים', 'מקוריתיים', 'חרטומניים', 'דרומסיים', 'שדמתיים'] },
  { name: 'שחפים ועופות ים', families: ['שחפיים', 'חמסניים', 'פתוניים', 'אלבטרוסיים', 'יסעוריים', 'פרגטיים', 'סולתיים'] },
  { name: 'חסידות, אנפות ושקנאים', families: ['חסידתיים', 'אנפתיים', 'שקנאיים', 'קורמורניים', 'נחשוניים', 'כפניים'] },
  { name: 'דורסי יום', families: ['נציים', 'שלכיים', 'בזיים'] },
  { name: 'ינשופים', families: ['ינשופיים', 'תנשמתיים'] },
  { name: 'שלדגים, שרקרקים ונקרים', families: ['דוכיפתיים', 'כחליים', 'שלדגיים', 'שרקרקיים', 'נקריים'] },
  { name: 'עורבים, חנקנים וזרזירים', families: ['עורביים', 'חנקניים', 'זרזיריים', 'זהבניים', 'דרונגים'] },
  { name: 'עפרונים, נחליאלים וסנוניות', families: ['עפרוניים', 'נחליאליים', 'סנוניתיים'] },
  { name: 'סבכיים ושיריות', families: ['סבכיי עַ לְוָוה', 'סבכיי קנים', 'חרגולניים', 'סיסטיקוליים', 'סבכיים', 'מלכילוניים', 'מדברוניים', 'זנבניים', 'שפמתניים', "צ'טיות"] },
  { name: 'קיכליים וחטפיתיים', families: ['קיכליים', 'חטפיתיים'] },
  { name: 'פרושים, גיבתונים ודרורים', families: ['פרושיים', 'גיבתוניים', 'קלקרידיים', 'דרוריים', 'אורגיים', 'אסטרילדיים'] },
  { name: 'ציפורי שיר נוספות', families: ['ירגזיים', 'רמיזיים', 'גנובתניים', 'בולבוליים', 'ציצניתיים', 'חיוורניתיים', 'סיטיים', 'כותליים', 'טפסיים', 'גדרוניים', 'צופיתיים', 'סתריים'] },
];

const groupByFamily = new Map<string, string>(
  GENERAL_GROUPS.flatMap((g) => g.families.map((f) => [f, g.name] as const)),
);

export function generalGroupOf(family: string): string {
  return groupByFamily.get(family) ?? NO_GROUP;
}

/** Display position of a group (unknown groups last). */
export function generalGroupRank(group: string): number {
  const i = GENERAL_GROUPS.findIndex((g) => g.name === group);
  return i === -1 ? GENERAL_GROUPS.length : i;
}
