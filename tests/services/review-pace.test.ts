import { describe, expect, it } from 'vitest';

import { MemoryRemoteStore } from '../../src/services/sync/memory-remote';
import { answerNext, DAY, device, practice } from './device-fixtures';

describe('review pace', () => {
  it('starts new learners on the frequent pace: a recalled character returns the next day', async () => {
    const phone = await device('phone');
    await expect(phone.database.settings.get('user')).resolves.toMatchObject({
      reviewPace: 'frequent',
    });

    await practice(phone);

    for (const card of await phone.database.cards.toArray()) {
      expect(card.dueAt - (card.schedulerState.card.lastReviewAt ?? 0)).toBe(DAY);
    }
  });

  it('schedules new reviews at the chosen pace', async () => {
    const phone = await device('phone');
    await phone.settings.setReviewPace('relaxed');

    await practice(phone);

    for (const card of await phone.database.cards.toArray()) {
      expect(card.dueAt - (card.schedulerState.card.lastReviewAt ?? 0)).toBeGreaterThan(4 * DAY);
    }
  });

  it('moves the next review of learned characters and nothing else when the pace changes', async () => {
    const phone = await device('phone');
    await practice(phone);
    const before = await phone.database.cards.orderBy('id').toArray();
    const events = await phone.database.events.orderBy('id').toArray();

    const slower = await phone.settings.setReviewPace('relaxed');

    expect(slower.rescheduled).toBe(3);
    expect(slower.settings.reviewPace).toBe('relaxed');
    const relaxed = await phone.database.cards.orderBy('id').toArray();
    relaxed.forEach((card, index) => {
      const original = before[index];
      expect(card.dueAt).toBeGreaterThan((original?.dueAt ?? 0) + 3 * DAY);
      expect(card.schedulerState.card.dueAt).toBe(card.dueAt);
      expect(card.version).toBe((original?.version ?? 0) + 1);
      // What the scheduler remembers about the character is untouched.
      const memory = (
        { stability, stabilityFast, difficulty, lastReviewAt, reps, lapses } = card.schedulerState
          .card,
      ) => ({ stability, stabilityFast, difficulty, lastReviewAt, reps, lapses });
      expect(memory()).toEqual(memory(original?.schedulerState.card));
      expect(card.scheduledReviewCount).toBe(original?.scheduledReviewCount);
    });
    await expect(phone.database.events.orderBy('id').toArray()).resolves.toEqual(events);

    // Going back restores the original dates; choosing the same pace again changes nothing.
    await expect(phone.settings.setReviewPace('frequent')).resolves.toMatchObject({
      rescheduled: 3,
    });
    const restored = await phone.database.cards.orderBy('id').toArray();
    expect(restored.map((card) => card.dueAt)).toEqual(before.map((card) => card.dueAt));
    await expect(phone.settings.setReviewPace('frequent')).resolves.toMatchObject({
      rescheduled: 0,
    });
    await expect(phone.backup.createExport()).resolves.toBeDefined();
  });

  it('leaves paused and not-yet-reviewed characters where they are', async () => {
    const phone = await device('phone');
    // One character is answered; the next is only introduced.
    let session = await answerNext(phone);
    session = (await phone.sessions.openNextItem(session.id, session.revision)).session;
    await phone.sessions.finishSession(session.id, session.revision);
    const [reviewed, introduced] = (await phone.database.cards.toArray()).sort(
      (left, right) => left.introducedAt - right.introducedAt,
    );
    if (reviewed === undefined || introduced === undefined) throw new Error('Fixture is short.');
    expect(introduced.scheduledReviewCount).toBe(0);
    await phone.database.cards.update(reviewed.id, { suspended: true });

    await expect(phone.settings.setReviewPace('relaxed')).resolves.toMatchObject({
      rescheduled: 0,
    });
    await expect(phone.database.cards.get(reviewed.id)).resolves.toMatchObject({
      dueAt: reviewed.dueAt,
    });
    await expect(phone.database.cards.get(introduced.id)).resolves.toEqual(introduced);
  });

  it('drops reviews from an open session that a slower pace makes not yet due', async () => {
    const phone = await device('phone');
    await practice(phone);
    phone.clock.value += 2 * DAY;
    const open = await answerNext(phone);
    expect(open.primaryItems.map((item) => item.status)).toEqual(['done', 'pending', 'pending']);

    await phone.settings.setReviewPace('relaxed');

    const resumed = await phone.sessions.startOrResumeSession();
    expect(resumed.id).toBe(open.id);
    expect(resumed.revision).toBeGreaterThan(open.revision);
    expect(resumed.primaryItems.map((item) => item.status)).toEqual(['done', 'skipped', 'skipped']);
  });

  it('carries the pace and the moved reviews to other devices', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    await phone.settings.setReviewPace('intensive');
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    await expect(tablet.database.settings.get('user')).resolves.toMatchObject({
      reviewPace: 'intensive',
    });
    const onPhone = await phone.database.cards.orderBy('id').toArray();
    const onTablet = await tablet.database.cards.orderBy('id').toArray();
    expect(onTablet.map((card) => card.dueAt)).toEqual(onPhone.map((card) => card.dueAt));
    await expect(tablet.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
  });
});

describe('review pace and older versions of the app', () => {
  it('keeps this device’s pace when the cloud settings have none', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    await phone.settings.setReviewPace('intensive');
    await phone.engine.sync(cloud);
    const { generation } = await phone.engine.readState();
    await cloud.push({
      generation: generation ?? '',
      deviceId: 'older-app',
      records: [
        {
          collection: 'settings',
          id: 'user',
          data: { dailyNewLimit: 2, onboardingCompleted: true, activeDeckId: 'standard' },
          deleted: false,
        },
      ],
    });

    await phone.engine.sync(cloud);

    await expect(phone.database.settings.get('user')).resolves.toMatchObject({
      dailyNewLimit: 2,
      reviewPace: 'intensive',
    });
    // The pace goes back up, so the account does not lose it.
    const [record] = await cloud
      .pull({
        generation: generation ?? '',
        afterSeq: 0,
        excludeDeviceId: 'nobody',
        limit: 1000,
      })
      .then((records) => records.filter((item) => item.collection === 'settings'));
    expect(record?.data).toMatchObject({ reviewPace: 'intensive' });
  });
});
