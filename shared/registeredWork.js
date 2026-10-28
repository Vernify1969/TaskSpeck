/** Domestic building work over this amount needs a registered builder in Victoria. */
export const REGISTERED_WORK_LIMIT_AUD = 10000;

export const REGISTERED_WORK_MESSAGE =
  `Jobs of this kind over $${REGISTERED_WORK_LIMIT_AUD.toLocaleString('en-AU')} need a registered builder in Victoria, so TaskSpeck can't take them for now.`;

/** Painting, handyman, and assembly are building-adjacent categories. */
const BUILDING_CATS = new Set(['painting', 'home', 'furniture']);

/** Renovation or building wording counts even when the category is something else. */
const BUILDING_TEXT = /\b(renovat\w*|building works?|domestic building|plaster\w*|retil\w*|til(?:e|ing|es)|grout\w*|paint\w*|undercoat|feature wall|handyman|cabinetr\w*|fit-?out|decking|carpentr\w*|gyprock|render(?:ing)?)\b/i;

export function isRegisteredWorkKind({ cat = '', text = '', title = '' } = {}) {
  if (BUILDING_CATS.has(String(cat || ''))) return true;
  return BUILDING_TEXT.test(`${title || ''} ${text || ''}`);
}

function pushAmount(nums, value) {
  if (value == null || value === '') return;
  const n = Number(String(value).replace(/,/g, ''));
  if (Number.isFinite(n)) nums.push(n);
}

/** Highest dollar figure among a fixed price, a quote, stage totals, and $ amounts in a label. */
export function moneyAmounts({ priceNum, budgetLabel, milestones, fee } = {}) {
  const nums = [];
  pushAmount(nums, priceNum);
  pushAmount(nums, fee);
  if (Array.isArray(milestones)) {
    const sum = milestones.reduce((total, stage) => total + (Number(stage && stage.amount) || 0), 0);
    if (sum > 0) nums.push(sum);
  }
  const found = [...String(budgetLabel || '').matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
  if (found.length) nums.push(Math.max(...found));
  return nums;
}

export function registeredWorkReason(job, amounts) {
  const list = Array.isArray(amounts) ? amounts : moneyAmounts(amounts);
  if (!list.some((n) => n > REGISTERED_WORK_LIMIT_AUD)) return null;
  if (!isRegisteredWorkKind(job)) return null;
  return REGISTERED_WORK_MESSAGE;
}
