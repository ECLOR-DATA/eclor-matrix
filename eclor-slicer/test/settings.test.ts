/**
 * Formatting-model integrity: globally-unique card/group names (playbook
 * §4.2.3), i18n key parity across locales, and capabilities.json ↔ settings
 * card synchronisation (playbook §4.2.5).
 */

import * as fs from "fs";
import * as path from "path";

import { VisualFormattingSettingsModel } from "../src/settings";

const root = path.resolve(__dirname, "..");
const en = JSON.parse(fs.readFileSync(path.join(root, "stringResources/en-US/resources.resjson"), "utf8"));
const fr = JSON.parse(fs.readFileSync(path.join(root, "stringResources/fr-FR/resources.resjson"), "utf8"));
const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8"));

describe("formatting model", () => {
  test("every Card.name is globally unique", () => {
    const model = new VisualFormattingSettingsModel();
    const names = model.cards.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every card has a displayNameKey present in both locales", () => {
    const model = new VisualFormattingSettingsModel();
    for (const card of model.cards) {
      const key = (card as { displayNameKey?: string }).displayNameKey;
      expect(key).toBeTruthy();
      expect(en[key as string]).toBeTruthy();
      expect(fr[key as string]).toBeTruthy();
    }
  });
});

describe("i18n", () => {
  test("en-US and fr-FR key sets match exactly", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  test("no empty translations", () => {
    for (const dict of [en, fr]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(typeof v).toBe("string");
        expect((v as string).length).toBeGreaterThan(0);
        expect(k.startsWith("Visual_")).toBe(true);
      }
    }
  });
});

describe("capabilities ↔ settings sync", () => {
  test("every settings card maps to a capabilities object with the same properties", () => {
    const model = new VisualFormattingSettingsModel();
    for (const card of model.cards) {
      const capObject = capabilities.objects[card.name];
      expect(capObject).toBeTruthy();
      // Composite slices (FontControl) persist through their SUB-slices'
      // property names, not their own name — expand them.
      const sliceNames = (card.slices ?? []).flatMap((s) => {
        const fc = s as { name: string; fontFamily?: { name: string }; fontSize?: { name: string } };
        if (fc.fontFamily && fc.fontSize) {
          const sub = s as unknown as {
            fontFamily: { name: string };
            fontSize: { name: string };
            bold?: { name: string };
            italic?: { name: string };
            underline?: { name: string };
          };
          return [sub.fontFamily, sub.fontSize, sub.bold, sub.italic, sub.underline]
            .filter((x): x is { name: string } => !!x)
            .map((x) => x.name);
        }
        return [fc.name];
      });
      for (const sliceName of sliceNames) {
        expect(Object.keys(capObject.properties)).toContain(sliceName);
      }
    }
  });

  test("the filter object required by applyJsonFilter is declared", () => {
    expect(capabilities.objects.general.properties.filter.type.filter).toBe(true);
  });

  test("cert-footer flags are present", () => {
    expect(capabilities.supportsLandingPage).toBe(true);
    expect(capabilities.supportsKeyboardFocus).toBe(true);
    expect(capabilities.privileges).toEqual([]);
    expect(capabilities.suppressDefaultTitle).toBe(true);
    expect(capabilities.supportsSynchronizingFilterState).toBe(true);
    expect(
      capabilities.dataViewMappings[0].categorical.categories.dataReductionAlgorithm.top.count
    ).toBe(10000);
  });

  test("every capabilities object with a displayName carries a displayNameKey known to both locales", () => {
    for (const [objName, obj] of Object.entries<Record<string, unknown>>(capabilities.objects)) {
      if (objName === "general") continue; // host-managed, not surfaced
      const key = obj.displayNameKey as string | undefined;
      expect(key).toBeTruthy();
      expect(en[key as string]).toBeTruthy();
      expect(fr[key as string]).toBeTruthy();
    }
  });

  test("every capability PROPERTY and enum member is localizable (audit I18N-01 regression)", () => {
    for (const [objName, obj] of Object.entries<{ properties: Record<string, unknown> }>(capabilities.objects)) {
      if (objName === "general") continue;
      for (const [propName, prop] of Object.entries(obj.properties)) {
        const p = prop as { displayNameKey?: string; type?: { enumeration?: { value: string; displayNameKey?: string }[] } };
        expect(`${objName}.${propName}:${p.displayNameKey}`).not.toContain("undefined");
        expect(en[p.displayNameKey as string]).toBeTruthy();
        expect(fr[p.displayNameKey as string]).toBeTruthy();
        for (const member of p.type?.enumeration ?? []) {
          expect(`${objName}.${propName}.${member.value}:${member.displayNameKey}`).not.toContain("undefined");
          expect(en[member.displayNameKey as string]).toBeTruthy();
          expect(fr[member.displayNameKey as string]).toBeTruthy();
        }
      }
    }
  });

  test("every settings slice and dropdown item carries a displayNameKey (audit I18N-01 regression)", () => {
    const model = new VisualFormattingSettingsModel();
    for (const card of model.cards) {
      for (const slice of card.slices ?? []) {
        const s = slice as { name: string; displayNameKey?: string; items?: { displayNameKey?: string }[] };
        expect(`${card.name}.${s.name}:${s.displayNameKey}`).not.toContain("undefined");
        expect(en[s.displayNameKey as string]).toBeTruthy();
        for (const item of s.items ?? []) {
          expect(en[item.displayNameKey as string]).toBeTruthy();
          expect(fr[item.displayNameKey as string]).toBeTruthy();
        }
      }
    }
  });

  test("dataRoles carry localized descriptions (audit I18N-02 regression)", () => {
    for (const role of capabilities.dataRoles) {
      expect(en[role.displayNameKey]).toBeTruthy();
      expect(en[role.descriptionKey]).toBeTruthy();
      expect(fr[role.descriptionKey]).toBeTruthy();
    }
  });
});
