import { resetDb } from './db';
import { resetScenario } from './scenarios';
import { setNow } from './util';

/** Put the mock backend back as it was at the start: seeded data, no scenario, the real clock. */
export function resetMocks() {
  resetDb();
  resetScenario();
  setNow(null);
}
