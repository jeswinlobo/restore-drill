import { replayRecordedRepair } from '../lib/recordings.mjs';

try {
  const replay = await replayRecordedRepair(process.argv[2] || 'kane');
  for (const result of replay.cases)
    console.log(result.stage + ' reproduced the recorded archive, including every checked bookmark path.');
  console.log('Original archive replay: ' + replay.originalReplay + '.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
