import test from 'node:test';
import assert from 'node:assert/strict';

function applyOps(state, ops) {
  const next = {
    rows: new Map(state.rows),
    appliedOps: new Set(state.appliedOps),
    nowCounter: state.nowCounter
  };

  const tick = () => {
    next.nowCounter += 1;
    return next.nowCounter;
  };

  for (const op of ops) {
    const opKey = `${op.deviceId}:${op.opId}`;
    if (next.appliedOps.has(opKey)) continue;

    const existing = next.rows.get(op.itemId);

    if (op.opType === 'delete') {
      if (existing) {
        next.rows.set(op.itemId, {
          ...existing,
          deletedAt: existing.deletedAt ?? tick(),
          updatedAt: tick(),
          updatedByDevice: op.deviceId
        });
      } else {
        next.rows.set(op.itemId, {
          itemId: op.itemId,
          text: op.text || '[deleted]',
          erledigt: false,
          position: op.position ?? 0,
          deletedAt: tick(),
          updatedAt: tick(),
          updatedByDevice: op.deviceId
        });
      }
    }

    if (op.opType === 'upsert') {
      if (existing?.deletedAt) {
        // delete-wins: stale updates must not resurrect
      } else {
        next.rows.set(op.itemId, {
          itemId: op.itemId,
          text: op.text,
          erledigt: Boolean(op.erledigt),
          position: op.position ?? 0,
          deletedAt: null,
          updatedAt: tick(),
          updatedByDevice: op.deviceId
        });
      }
    }

    next.appliedOps.add(opKey);
  }

  return next;
}

function activeRows(state) {
  return [...state.rows.values()]
    .filter(row => !row.deletedAt)
    .sort((a, b) => a.position - b.position || a.itemId.localeCompare(b.itemId));
}

function initialState() {
  return { rows: new Map(), appliedOps: new Set(), nowCounter: 0 };
}

test('parallel offline create/create keeps both items', () => {
  const start = initialState();
  const end = applyOps(start, [
    { deviceId: 'A', opId: '1', opType: 'upsert', itemId: 'a1', text: 'Milch', erledigt: false, position: 0 },
    { deviceId: 'B', opId: '1', opType: 'upsert', itemId: 'b1', text: 'Brot', erledigt: false, position: 1 }
  ]);

  assert.equal(activeRows(end).length, 2);
  assert.deepEqual(activeRows(end).map(r => r.itemId), ['a1', 'b1']);
});

test('parallel offline update/update same item uses last-write-wins', () => {
  let state = initialState();
  state = applyOps(state, [
    { deviceId: 'A', opId: '1', opType: 'upsert', itemId: 'x1', text: 'Tomaten', erledigt: false, position: 0 }
  ]);

  state = applyOps(state, [
    { deviceId: 'A', opId: '2', opType: 'upsert', itemId: 'x1', text: 'Tomaten Dose', erledigt: false, position: 0 },
    { deviceId: 'B', opId: '1', opType: 'upsert', itemId: 'x1', text: 'Tomaten Bio', erledigt: false, position: 0 }
  ]);

  assert.equal(activeRows(state)[0].text, 'Tomaten Bio');
});

test('delete/update conflict keeps item deleted (no resurrection)', () => {
  let state = initialState();
  state = applyOps(state, [
    { deviceId: 'A', opId: '1', opType: 'upsert', itemId: 'x1', text: 'Kaffee', erledigt: false, position: 0 }
  ]);

  state = applyOps(state, [
    { deviceId: 'A', opId: '2', opType: 'delete', itemId: 'x1', text: 'Kaffee', position: 0 },
    { deviceId: 'B', opId: '1', opType: 'upsert', itemId: 'x1', text: 'Kaffee entkoff.', erledigt: false, position: 0 }
  ]);

  assert.equal(activeRows(state).length, 0);
  assert.ok(state.rows.get('x1')?.deletedAt);
});

test('repeated sync is idempotent (duplicate op ignored)', () => {
  let state = initialState();
  const op = { deviceId: 'A', opId: '42', opType: 'upsert', itemId: 'x1', text: 'Reis', erledigt: false, position: 0 };

  state = applyOps(state, [op]);
  const once = activeRows(state)[0];
  state = applyOps(state, [op]);
  const twice = activeRows(state)[0];

  assert.equal(activeRows(state).length, 1);
  assert.equal(once.text, twice.text);
});
