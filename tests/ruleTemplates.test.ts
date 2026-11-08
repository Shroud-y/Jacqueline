import { describe, expect, it } from 'vitest';
import { characterSchema, defaultCharacter } from '@shared/character';
import { applyTemplate, RULE_TEMPLATES } from '@shared/ruleTemplates';

describe('rule templates', () => {
  it('each makes a character that is still valid, with its rule and the group it says from', () => {
    for (const template of RULE_TEMPLATES) {
      const made = applyTemplate(defaultCharacter('c', 'Teto'), template.id);
      expect(made, template.id).not.toBeNull();
      expect(characterSchema.safeParse(made?.character).success, template.id).toBe(true);
      for (const action of made?.rule.then ?? []) {
        if (action.type === 'say') expect(made?.character.lines[action.group]?.length, template.id).toBeGreaterThan(0);
      }
    }
  });

  it('takes a group name that is free, and a rule id that is free', () => {
    const base = { ...defaultCharacter('c', 'Teto'), lines: { Poke: [{ id: 'mine', text: 'Mine.' }] } };
    const once = applyTemplate(base, 'poke');
    const twice = once ? applyTemplate(once.character, 'poke') : null;
    expect(once?.character.lines.Poke).toEqual([{ id: 'mine', text: 'Mine.' }]);
    expect(Object.keys(twice?.character.lines ?? {})).toEqual(['Poke', 'Poke 2', 'Poke 3']);
    expect(new Set(twice?.character.rules.map((rule) => rule.id)).size).toBe(2);
  });

  it('says nothing for a template that is not there', () => {
    expect(applyTemplate(defaultCharacter('c', 'Teto'), 'nope')).toBeNull();
  });
});
