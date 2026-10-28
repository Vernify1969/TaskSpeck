/** Sample people for `npm run demo`. Passwords are shown on the sign-in screen only while demo mode is on. */
export const DEMO_PASSWORD = 'demo-help-2026';

export const DEMO_ACCOUNTS = [
  { name: 'Maya Chen', email: 'maya.demo@taskspeck.test', password: DEMO_PASSWORD, role: 'Requester', note: 'Posts tasks in Carlton', suburb: 'Carlton', tasker: false },
  { name: 'Sam Taylor', email: 'sam.demo@taskspeck.test', password: DEMO_PASSWORD, role: 'Tasker', note: 'Makes offers from Melbourne', suburb: 'Melbourne', tasker: true },
  { name: 'Priya Nair', email: 'priya.demo@taskspeck.test', password: DEMO_PASSWORD, role: 'Tasker', note: 'Makes offers from Richmond', suburb: 'Richmond', tasker: true },
  { name: 'Casey Outer', email: 'casey.demo@taskspeck.test', password: DEMO_PASSWORD, role: 'Outside the zone', note: 'Frankston is not open yet', suburb: 'Frankston', tasker: false },
];

export function demoPublic() {
  if (process.env.TASKSPECK_DEMO !== '1') return { enabled: false, accounts: [] };
  return {
    enabled: true,
    accounts: DEMO_ACCOUNTS.map((account) => ({
      name: account.name,
      email: account.email,
      password: account.password,
      role: account.role,
      note: account.note,
    })),
  };
}
