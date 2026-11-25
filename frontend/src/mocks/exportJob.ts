// What an export's job does as it runs: its progress is the export's, and when it ends the export is Ready (the
// matter Exported, unless the query moved on meanwhile) or Failed (the matter back as it was). Shared by a new
// export (handlers/exports.ts) and the seeded ones still preparing in Purview (jobs.ts follows those).
import type { Schemas } from '@/api/client';
import type { MockJob, MockMatter } from './db';
import { appendLog } from './log';
import { clone, iso } from './util';

type S = Schemas;

export function exportJobBehaviour(m: MockMatter, exp: S['Export'], stageBefore: S['MatterStage']): Pick<MockJob, 'finish' | 'onProgress' | 'onFail'> {
  return {
    onProgress: (progress) => {
      exp.progress = progress;
    },
    onFail: () => {
      exp.status = 'failed';
      m.matter.stage = stageBefore; // as it was before the export started
    },
    finish: () => {
      const done = iso();
      Object.assign(exp, {
        status: 'ready', progress: 1, finished_at: done, expires_at: iso(new Date(new Date(done).getTime() + 30 * 86_400_000)),
        files: [{ name: 'Exchange.zip', size_bytes: Math.round(exp.counts.size_bytes * 0.6) }, { name: 'SharePoint.zip', size_bytes: Math.round(exp.counts.size_bytes * 0.4) }],
      });
      // Exported, unless the query moved on to a new version while the export ran.
      m.matter.stage = m.matter.current_version === exp.version ? 'exported' : 'scoping';
      const version = m.versions.find((v) => v.version === exp.version);
      if (version) version.exported = true;
      appendLog(m, 'export_finished', `${exp.name} · ready in Purview`, exp.version, { files: exp.files }, true);
      return clone(exp);
    },
  };
}
