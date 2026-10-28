/**
 * Same blocked-task rules the app uses before a listing can go live.
 * Licensed, dangerous and out-of-pilot work is refused here as well,
 * so the API cannot skip the check.
 */
const BLOCK = [
  [/\b(dog|cat|puppy|kitten|pets?|walk my|feed my|fish tank|plants?|watering)\b/i, 'Pet and plant care is not available during the Melbourne CBD pilot.'],
  [/\b(airbnb|turnover|short.?stay|key handover|linen)\b/i, 'Host turnovers are not available during the Melbourne CBD pilot.'],
  [/\b(staff|staffing|waiters?|waitress\w*|bartend\w*|barista|kitchen ?hand|promo(tional)?|receptionist|personal assistant|shifts?|roster\w*|casual (worker|staff|role)|per hour|an hour|\/ ?hr|hourly|full.?time|part.?time)\b/i, 'TaskSpeck is for one-off jobs at a fixed price. Staffing, shifts, hourly roles and ongoing positions cannot be posted.'],
  [/(mount\w*|install\w*|hang\w*|wall|connect\w*|set ?up|wir\w*|cabl\w*|bracket).{0,40}\b(tv|tvs|television)\b|\b(tv|tvs|television)\b.{0,40}(mount\w*|install\w*|wall|bracket|connect\w*|set ?up|wir\w*|cabl\w*|antenna|hdmi|soundbar)|\b(antenna|soundbar|hdmi)\b/i, 'TV work can involve power points, concealed cabling or antenna points, which must be done by a licensed electrician, so TV tasks cannot be posted on TaskSpeck.'],
  [/electric|power ?point|wiring|rewir|switchboard|light fitting|circuit/i, 'This task involves electrical work and cannot be posted on TaskSpeck because it may require a licensed professional.'],
  [/\bgas\b/i, 'This task involves gas work and cannot be posted on TaskSpeck because it requires a licensed professional.'],
  [/plumb|hot water system|blocked drain|burst pipe|toilet install|tap install/i, 'This task involves plumbing work and cannot be posted on TaskSpeck because it may require a licensed professional.'],
  [/\broof|gutter|demolish|demolition|load.?bearing|structural|knock (down|out) (a |the )?wall|scaffold|asbestos|renovat/i, 'This task involves building or structural work and cannot be posted on TaskSpeck.'],
  [/pest control|termite|chainsaw|tree (removal|felling)|forklift|\bcrane\b/i, 'This task involves specialist or dangerous equipment and cannot be posted on TaskSpeck.'],
  [/waterproof/i, 'Waterproofing is not available during the pilot because mistakes can damage other units.'],
  [/gas (bottle|cylinder)|syringe|\bsharps\b|paint tins?|pesticide|solvent|fireworks|car batter(y|ies)|\bfuel\b|oil drum/i, 'Hazardous waste such as chemicals, gas bottles, batteries and sharps cannot be handled through TaskSpeck.'],
  [/\bweapons?\b|firearm|\bguns?\b|ammunition|hazardous|chemical|\bdrugs?\b/i, 'This task involves items or materials that cannot be handled through TaskSpeck.'],
  [/medic(ation|ine|al)|\bnurs(e|ing)|aged care|disability care|personal care|\bwound|injection/i, 'Medical and professional care tasks cannot be posted on TaskSpeck.'],
  [/babysit|child ?care|\btutor\w*|school pick ?up|\bnanny|(look|mind|watch) after (my |the )?(kids|children|baby|toddler)/i, 'Childcare cannot be arranged through TaskSpeck.'],
  [/security guard|bodyguard|legal advice|lawyer|conveyanc|tax return|financial advice|\binvest/i, 'Security, legal and financial services cannot be posted on TaskSpeck because they may require registration.'],
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
  if (a.wet === 'Yes') return 'Wet-area work involves waterproofing and cannot be posted during the pilot.';
  if (a.haz === 'Yes') return 'Hazardous waste (chemicals, paint, gas bottles, asbestos or sharps) cannot be handled through TaskSpeck.';
  if (a.cable === 'Yes') return 'New cabling or wiring inside walls must be done by a licensed professional.';
  if (a.hazard === 'Yes') return 'Restricted or hazardous items cannot be handled through TaskSpeck.';
  return null;
}
