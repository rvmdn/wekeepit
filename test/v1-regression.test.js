const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const MetadataEngine = require('../metadata-engine.js');
const ReminderService = require('../reminder-service.js');

describe('V1 Regression Suite', () => {

  describe('MetadataEngine Query Parsing & Tag Logic', () => {
    const meta = new MetadataEngine();
    meta.setSchema({
      fields: [
        { key: 'url', label: 'Link / URL', type: 'url', icon: '🔗' },
        { key: 'role', label: 'Role / Akses', type: 'badge', icon: '👤' }
      ],
      tagPalette: {
        link: '#3b82f6',
        role: '#8b5cf6'
      }
    });

    test('should parse empty or whitespace query correctly', () => {
      const q = meta.parseQuery('   ');
      assert.equal(q.isEmpty, true);
    });

    test('should parse AND syntax with plus symbol (link+role)', () => {
      const q = meta.parseQuery('link+role+vpn');
      assert.equal(q.isEmpty, false);
      assert.equal(q.mode, 'AND_TAGS');
      assert.deepEqual(q.requiredTags, ['link', 'role', 'vpn']);
    });

    test('should parse OR syntax with comma symbol (link, role)', () => {
      const q = meta.parseQuery('link, role');
      assert.equal(q.isEmpty, false);
      assert.equal(q.mode, 'OR_TAGS');
      assert.deepEqual(q.orTags, ['link', 'role']);
    });

    test('should parse mixed query with hashtags and text terms', () => {
      const q = meta.parseQuery('#link #role ams refresh');
      assert.equal(q.isEmpty, false);
      assert.equal(q.mode, 'MIXED');
      assert.deepEqual(q.requiredTags, ['link', 'role']);
      assert.deepEqual(q.textTerms, ['ams', 'refresh']);
    });

    test('should match card with AND tags only if all tags present', () => {
      const cardA = {
        title: 'User Access',
        content: 'VPN configuration',
        tags: ['link', 'role', 'vpn'],
        metadata: {}
      };
      const cardB = {
        title: 'Only link',
        content: 'General information',
        tags: ['link'],
        metadata: {}
      };

      const qAnd = meta.parseQuery('link+role');
      assert.equal(meta.matches(cardA, qAnd), true);
      assert.equal(meta.matches(cardB, qAnd), false);
    });

    test('should match card with OR tags if any tag present', () => {
      const card = { title: 'Doc', tags: ['vpn'] };
      const qOr = meta.parseQuery('link, vpn');
      assert.equal(meta.matches(card, qOr), true);

      const qOrFail = meta.parseQuery('link, role');
      assert.equal(meta.matches(card, qOrFail), false);
    });

    test('should match query across metadata, checklist, and attachments corpus', () => {
      const card = {
        title: 'Server Config',
        content: 'Details here',
        tags: ['infra'],
        metadata: { pic: 'Budi Santoso' },
        checklist: [{ text: 'Deploy to staging', done: false }]
      };

      const qPic = meta.parseQuery('budi');
      assert.equal(meta.matches(card, qPic), true);

      const qChecklist = meta.parseQuery('staging');
      assert.equal(meta.matches(card, qChecklist), true);
    });

    test('should return configured tag color or deterministic color for unknown tag', () => {
      assert.equal(meta.getTagColor('link'), '#3b82f6');
      assert.equal(meta.getTagColor('role'), '#8b5cf6');
      
      const customColor1 = meta.getTagColor('new-custom-tag');
      const customColor2 = meta.getTagColor('new-custom-tag');
      assert.ok(customColor1.startsWith('#'));
      assert.equal(customColor1, customColor2, 'Color for identical tag must be deterministic');
    });

    test('should extract and sort all unique tags with frequency', () => {
      const cards = [
        { tags: ['link', 'role'] },
        { tags: ['link', 'ams'] },
        { tags: ['link'] }
      ];
      const tagStats = meta.extractAllTags(cards);
      assert.equal(tagStats.length, 3);
      assert.equal(tagStats[0].tag, 'link');
      assert.equal(tagStats[0].count, 3);
      assert.equal(tagStats[1].count, 1);
    });
  });

  describe('ReminderService Logic', () => {
    let triggeredCard = null;
    let updatedCard = null;
    const reminderService = new ReminderService(
      (card) => { triggeredCard = card; },
      (card) => { updatedCard = card; }
    );

    test('should correctly format past countdowns', () => {
      const now = Date.now();
      const past15m = new Date(now - 15 * 60 * 1000).toISOString();
      const past2h = new Date(now - 2 * 3600 * 1000).toISOString();

      assert.equal(reminderService.formatCountdown(past15m), 'Terlewat 15m lalu');
      assert.equal(reminderService.formatCountdown(past2h), 'Terlewat 2j lalu');
    });

    test('should correctly format future countdowns', () => {
      const now = Date.now();
      const future15m = new Date(now + 15 * 60 * 1000).toISOString();
      const future2h = new Date(now + 2 * 3600 * 1000 + 5 * 60 * 1000).toISOString();
      const future3d = new Date(now + 3 * 24 * 3600 * 1000).toISOString();

      assert.equal(reminderService.formatCountdown(future15m), 'Dalam 15m');
      assert.equal(reminderService.formatCountdown(future2h), 'Dalam 2j 5m');
      assert.equal(reminderService.formatCountdown(future3d), 'Dalam 3 hari');
    });

    test('should snooze card by advancing time by specified minutes', () => {
      const card = {
        id: 'card-1',
        title: 'Meeting',
        reminder: { datetime: new Date().toISOString(), dismissed: false }
      };
      reminderService.setCards([card]);
      reminderService.snooze('card-1', 10);

      assert.ok(updatedCard);
      const isoStr = updatedCard.reminder.datetime.endsWith('Z') ? updatedCard.reminder.datetime : updatedCard.reminder.datetime + 'Z';
      const newDue = new Date(isoStr).getTime();
      const diffMins = Math.round((newDue - Date.now()) / 60000);
      assert.equal(diffMins, 10);
      assert.equal(updatedCard.reminder.dismissed, false);
    });

    test('should dismiss single reminder as dismissed=true', () => {
      const card = {
        id: 'card-2',
        title: 'Once task',
        reminder: { datetime: new Date().toISOString(), repeat: 'none', dismissed: false }
      };
      reminderService.setCards([card]);
      reminderService.dismiss('card-2');

      assert.equal(updatedCard.reminder.dismissed, true);
    });

    test('should advance daily reminder by 1 day and keep dismissed=false', () => {
      const initial = new Date('2026-10-15T09:00:00.000Z');
      const card = {
        id: 'card-3',
        title: 'Daily Standup',
        reminder: { datetime: initial.toISOString().slice(0, 19), repeat: 'daily', dismissed: false }
      };
      reminderService.setCards([card]);
      reminderService.dismiss('card-3');

      assert.equal(updatedCard.reminder.dismissed, false);
      const advanced = new Date(updatedCard.reminder.datetime);
      assert.equal(advanced.getDate(), initial.getDate() + 1);
    });
  });

  describe('V1 Data Files Integrity', () => {
    test('wekeepit-data.json should be valid JSON array of cards', () => {
      const filePath = path.join(__dirname, '..', 'wekeepit-data.json');
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      assert.ok(Array.isArray(data));
      if (data.length > 0) {
        const first = data[0];
        assert.ok(first.id, 'Card must have an ID');
        assert.ok(first.title !== undefined, 'Card must have a title');
        assert.ok(Array.isArray(first.tags), 'Card must have tags array');
      }
    });

    test('metadata-schema.json should be valid schema with fields and tagPalette', () => {
      const filePath = path.join(__dirname, '..', 'metadata-schema.json');
      const content = fs.readFileSync(filePath, 'utf-8');
      const schema = JSON.parse(content);
      assert.ok(Array.isArray(schema.fields), 'Schema must have fields array');
      assert.ok(typeof schema.tagPalette === 'object', 'Schema must have tagPalette');
    });
  });

});
