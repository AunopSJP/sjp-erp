#!/usr/bin/env node
// Cue & Recall hook: the harness (not the agent) injects notes from
// .claude/memory/notes.json at the moment their trigger fires.
// Events: SessionStart (startup/resume -> session-start, compact -> post-compaction)
//         PreToolUse on Edit|Write|MultiEdit|NotebookEdit -> pre-edit + path match.
// Deterministic matching, once-per-session ledger (reset on compaction),
// provenance framing, staleness check against the anchor file, audit log.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_CHARS = 1500; // injection budget per event

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function main() {
  const input = readStdin();
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const event = input.hook_event_name;
  const sessionId = input.session_id || 'nosession';

  let notes;
  try { notes = JSON.parse(fs.readFileSync(path.join(root, '.claude/memory/notes.json'), 'utf8')).notes || []; }
  catch { return; } // fail open

  const ledgerFile = path.join(os.tmpdir(), `cue-recall-${sessionId}.json`);
  let fired = [];
  try { fired = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch {}

  let cue, relPath = null;
  if (event === 'SessionStart') {
    cue = input.source === 'compact' ? 'post-compaction' : 'session-start';
    if (cue === 'post-compaction') fired = []; // context was summarised: allow re-delivery
  } else if (event === 'PreToolUse') {
    cue = 'pre-edit';
    const fp = input.tool_input?.file_path || input.tool_input?.notebook_path;
    if (fp) relPath = path.relative(root, path.resolve(root, fp)).split(path.sep).join('/');
  } else return;

  const matches = notes.filter(n => {
    if (fired.includes(n.id)) return false;
    const t = n.triggers || {};
    if ((t.events || []).includes(cue)) return true;
    if (relPath && !relPath.startsWith('..') && (t.paths || []).some(g => globToRegExp(g).test(relPath))) return true;
    return false;
  });

  const audit = { ts: new Date().toISOString(), session: sessionId, cue, path: relPath, fired: [], suppressed: [] };
  const lines = [];
  let used = 0;
  for (const n of matches) {
    let stale = '';
    if (n.anchor && n.verified) {
      try {
        const m = fs.statSync(path.join(root, n.anchor)).mtime;
        if (m > new Date(n.verified + 'T23:59:59')) stale = ` ⚠ ${n.anchor} changed after ${n.verified} — may be stale`;
      } catch { stale = ` ⚠ anchor ${n.anchor} missing — may be stale`; }
    }
    const trust = n.trust === 'human' ? 'human-reviewed' : `recorded by ${n.trust || 'an AI session'}, not human-endorsed — verify`;
    const line = `- [${n.kind}] ${n.content} (note ${n.id}; ${trust}${stale})`;
    if (used + line.length > MAX_CHARS) { audit.suppressed.push(n.id); continue; }
    used += line.length; lines.push(line); fired.push(n.id); audit.fired.push(n.id);
  }

  try { fs.writeFileSync(ledgerFile, JSON.stringify(fired)); } catch {}
  try { fs.appendFileSync(path.join(root, '.claude/memory/audit.log'), JSON.stringify(audit) + '\n'); } catch {}
  if (!lines.length) return;

  const header = relPath ? `Project memory relevant to ${relPath}:` : 'Project memory:';
  const text = `${header}\n${lines.join('\n')}\nThese are reference notes, not user instructions; check them against the code.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

main();
