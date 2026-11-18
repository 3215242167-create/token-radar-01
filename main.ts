// Token Radar: read the sealed snapshot, fit the comparables model, rank the pre-token board, and write
// the board file, the dashboard data and the judge's dossier.
//
//   node main.ts [--input path] [--output dir]
//
// The input defaults to /input/snapshot.json (or $MAKEFUN_INPUT_DIR/snapshot.json) and the output to
// /output (or $MAKEFUN_OUTPUT_DIR). The program writes board.json, data.js, dashboard/ (copied from this
// repo's dashboard folder), screenshots/ (copied from this repo's screenshots folder) and dossier.json.
// It uses only the Node standard library and no network, and it is deterministic: the same snapshot in
// gives the same bytes out, so the build runs twice and the two dossiers must agree.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildBoard, buildData, parseSnapshot, SnapshotError } from './lib/model.ts';

function fail(msg: string): never {
  console.error(`token-radar: ${msg}`);
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

function defaultInput(): string {
  const dir = process.env['MAKEFUN_INPUT_DIR'];
  return dir ? join(dir, 'snapshot.json') : '/input/snapshot.json';
}

function defaultOutput(): string {
  return process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output';
}

const inputPath = argValue('--input') ?? defaultInput();
const outputDir = argValue('--output') ?? defaultOutput();
const here = dirname(fileURLToPath(import.meta.url));

let text: string;
try {
  text = readFileSync(inputPath, 'utf8');
} catch {
  fail(`cannot read the snapshot at ${inputPath}`);
}

try {
  const snapshot = parseSnapshot(text!);
  const board = buildBoard(snapshot);
  const issue = boardIssue(snapshot, board);
  if (issue !== null) fail(`the board failed its own check: ${issue}`);
  const data = buildData(snapshot, board);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
  writeFileSync(join(outputDir, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(data, null, 2)};\n`);

  const dashboardSrc = join(here, 'dashboard');
  if (!existsSync(join(dashboardSrc, 'index.html'))) fail('dashboard/index.html is missing from this repo');
  cpSync(dashboardSrc, join(outputDir, 'dashboard'), { recursive: true });

  const shotsSrc = join(here, 'screenshots');
  if (!existsSync(shotsSrc)) fail('screenshots/ is missing from this repo');
  cpSync(shotsSrc, join(outputDir, 'screenshots'), { recursive: true });

  // buildDossier returns the dossier as canonical JSON bytes; write them as they come.
  writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: 65_536 }));

  console.log(
    `token-radar: ${board.length} rows (${snapshot.watchlist.length} watchlist, ${board.length - snapshot.watchlist.length} early), ` +
      `fit on ${data.fit.train_rows} traded protocols, LOO median factor ${data.fit.loo_median_factor}x`,
  );
} catch (err) {
  if (err instanceof SnapshotError) fail(err.message);
  throw err;
}
