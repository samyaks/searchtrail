// The people in the mock directory: the same six as the backend's dry-run directory (SAMPLE_DIRECTORY in
// backend/searchtrail/dryrun.py), so the mocks and `npm run dev:api` show the same people. A test checks
// they match. Alex Wilber and Megan Bowen are the custodians in the contract's Falcon examples.
export type Person = { id: string; display_name: string; email: string; department: string };

export const PEOPLE: readonly Person[] = [
  { id: '3c1a7f5e-0000-4000-8000-0000000000a1', display_name: 'Alex Wilber', email: 'alex.wilber@contoso.com', department: 'Procurement' },
  { id: '3c1a7f5e-0000-4000-8000-0000000000b2', display_name: 'Megan Bowen', email: 'megan.bowen@contoso.com', department: 'Finance' },
  { id: '3c1a7f5e-0000-4000-8000-0000000000c3', display_name: 'Hannah Ortega', email: 'hannah.ortega@contoso.com', department: 'Finance' },
  { id: '3c1a7f5e-0000-4000-8000-0000000000d4', display_name: 'Ravi Menon', email: 'ravi.menon@contoso.com', department: 'Procurement' },
  { id: '3c1a7f5e-0000-4000-8000-0000000000e5', display_name: 'Tomas Becker', email: 'tomas.becker@contoso.com', department: 'Sales' },
  { id: '3c1a7f5e-0000-4000-8000-0000000000f6', display_name: 'Grace Okafor', email: 'grace.okafor@contoso.com', department: 'Legal' },
];

export const initialsOf = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase();
};

export const findPerson = (id: string) => PEOPLE.find((p) => p.id === id);

/** People whose name, email or department contains `q`, ignoring case. */
export const searchPeople = (q: string) => {
  const needle = q.trim().toLowerCase();
  return needle ? PEOPLE.filter((p) => `${p.display_name} ${p.email} ${p.department}`.toLowerCase().includes(needle)) : [];
};
