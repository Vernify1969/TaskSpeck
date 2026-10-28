/**
 * Blocks licensed, dangerous, or unsuitable work before a listing can go live.
 * Licensed trades are not offered. The message tells people to use a licensed tradesperson.
 */
const LICENSED = 'TaskSpeck doesn\'t offer licensed work at the moment, so you\'ll need a licensed tradesperson.';

const BLOCK = [
  [/\b(staff|staffing|waiters?|waitress\w*|bartend\w*|barista|kitchen ?hand|promo(tional)?|receptionist|personal assistant|shifts?|roster\w*|casual (worker|staff|role)|per hour|an hour|\/ ?hr|hourly|full.?time|part.?time)\b/i, 'TaskSpeck is for a fixed price for a job, not staffing, shifts or hourly roles.'],
  [/data ?cabl\w*|structured cabling|network cabling|\bantenna\b/i, `Data cabling and antenna installs need a registered cabler. ${LICENSED}`],
  [/(mount\w*|hang\w*|wall|wir\w*|bracket).{0,40}\b(tv|tvs|television)\b|\b(tv|tvs|television)\b.{0,40}(mount\w*|hang\w*|wall|bracket|wir\w*)/i, `TV mounting can be electrical. ${LICENSED}`],
  [/electric|power ?point|wiring|rewir|switchboard|light fitting|circuit|air[\s-]?con|aircon|refrigerat/i, `This looks like electrical, air-conditioning or refrigeration work. ${LICENSED}`],
  [/\bgas\b/i, `This looks like gas work. ${LICENSED}`],
  [/plumb|hot water system|blocked drain|burst pipe|toilet install|tap install/i, `This looks like plumbing. ${LICENSED}`],
  [/\broof|gutter|demolish|demolition|load.?bearing|structural|knock (down|out) (a |the )?wall|scaffold|asbestos/i, `This looks like building, roofing or asbestos work. ${LICENSED}`],
  [/pest control|termite|pesticide/i, `Pest control that uses chemicals needs a licence. ${LICENSED}`],
  [/waterproof/i, `Waterproofing is licensed work. ${LICENSED}`],
  [/locksmith|rekey|re-key/i, `Locksmith work is licensed. ${LICENSED}`],
  [/chainsaw|tree (removal|felling)|forklift|\bcrane\b/i, 'This job needs specialist or dangerous equipment, so it can\'t be posted on TaskSpeck.'],
  [/gas (bottle|cylinder)|syringe|\bsharps\b|paint tins?|solvent|fireworks|car batter(y|ies)|\bfuel\b|oil drum/i, 'Hazardous waste such as chemicals, gas bottles, batteries and sharps can\'t be handled through TaskSpeck.'],
  [/\bweapons?\b|firearm|\bguns?\b|ammunition|hazardous|chemical|\bdrugs?\b/i, 'This task involves items or materials that can\'t be handled through TaskSpeck.'],
  [/medic(ation|ine|al)|\bnurs(e|ing)|aged care|disability care|personal care|\bwound|injection/i, 'Medical and professional care tasks can\'t be posted on TaskSpeck.'],
  [/babysit|child ?care|\btutor\w*|school pick ?up|\bnanny|(look|mind|watch) after (my |the )?(kids|children|baby|toddler)/i, 'Childcare can\'t be arranged through TaskSpeck.'],
  [/security guard|bodyguard|legal advice|lawyer|conveyanc|tax return|financial advice|\binvest/i, 'Security, legal and financial services can\'t be posted on TaskSpeck because they may need registration.'],
];

export function prohibitedReason(text) {
  const found = BLOCK.find(([re]) => re.test(String(text || '')));
  return found ? found[1] : null;
}

/** Answer-driven blocks that match the in-app safety check (high risk only). */
export function highRiskAnswer(answers = {}) {
  const a = answers || {};
  if (a.height === 'Yes') return 'Work at significant height cannot be posted automatically because of the safety risk.';
  if (a.bio === 'Yes') return 'Mould, pest infestations, needles and other biohazards need a specialist cleaner and cannot be posted on TaskSpeck.';
  if (a.wet === 'Yes') return 'Wet-area waterproofing is licensed work. TaskSpeck doesn\'t offer licensed work at the moment, so you\'ll need a licensed tradesperson.';
  if (a.haz === 'Yes') return 'Hazardous waste (chemicals, paint, gas bottles, asbestos or sharps) can\'t be handled through TaskSpeck.';
  if (a.cable === 'Yes') return 'Data cabling and antenna installs need a registered cabler. TaskSpeck doesn\'t offer licensed work at the moment, so you\'ll need a licensed tradesperson.';
  if (a.hazard === 'Yes') return 'Restricted or hazardous items cannot be handled through TaskSpeck.';
  return null;
}
