import { issue } from './issues.mjs';

export function auditProfessional(project, concept) {
  const findings = [];
  const designIntent = project.designIntent || {};
  const materials = Array.isArray(designIntent.materials) ? designIntent.materials.filter((material) => material && typeof material === 'object') : [];
  const materialById = new Map(materials.map((material) => [material.materialId, material]));
  if (!Array.isArray(designIntent.style) || !designIntent.style.length) {
    findings.push(issue(project, 'design.style-unspecified', 'warning', 'No observable style intent is recorded for the selected concept.', {
      fix: 'Record contrast, tone, texture, gloss, visual density, and other observable style decisions.',
    }));
  }
  if (!Array.isArray(designIntent.lighting) || !designIntent.lighting.length) {
    findings.push(issue(project, 'design.lighting-unspecified', 'warning', 'No lighting intent is recorded for the selected concept.', {
      fix: 'Record daylight, ambient, task, and accent-lighting intent before detailed design.',
    }));
  }
  if (!Array.isArray(designIntent.maintenance) || !designIntent.maintenance.length) {
    findings.push(issue(project, 'materials.maintenance-unspecified', 'warning', 'No material maintenance intent is recorded.', {
      fix: 'Record cleaning, replacement, finish durability, and supplier-verification expectations.',
      professionalVerification: true,
    }));
  }
  for (const level of concept.levels) {
    for (const room of level.rooms) {
      if (room.materialId && !materialById.has(room.materialId)) {
        findings.push(issue(project, 'materials.intent-missing', 'blocking', `${room.name} references material intent that is not defined.`, {
          nodeIds: [room.roomId],
          levelIds: [level.levelId],
          measurement: { materialId: room.materialId, defined: false },
          threshold: { requiredDefined: true },
          thresholdSource: 'product-concept-default',
          fix: 'Define the referenced material intent or assign a governed material to the room.',
        }));
      }
      if (!/bathroom|kitchen|laundry|wet|卫生|厨房|洗衣/i.test(`${room.kind} ${room.name}`)) continue;
      const material = materialById.get(room.materialId);
      if (material?.wetAreaSuitability === 'unsuitable') {
        findings.push(issue(project, 'materials.wet-area-unsuitable', 'blocking', `${material.name || material.materialId} is recorded as unsuitable for ${room.name}.`, {
          nodeIds: [room.roomId],
          levelIds: [level.levelId],
          fix: 'Choose a material with verified wet-area suitability and maintenance documentation.',
          professionalVerification: true,
        }));
      } else if (!material?.wetAreaSuitability) {
        findings.push(issue(project, 'materials.wet-area-unverified', 'warning', `${room.name} material suitability is not verified.`, {
          nodeIds: [room.roomId],
          levelIds: [level.levelId],
          fix: 'Verify slip resistance, water resistance, installation system, and maintenance with the supplier.',
          professionalVerification: true,
        }));
      }
    }
    for (const item of level.items) {
      if (item.materialId && !materialById.has(item.materialId)) {
        findings.push(issue(project, 'materials.intent-missing', 'blocking', `${item.name} references material intent that is not defined.`, {
          nodeIds: [item.itemId],
          levelIds: [level.levelId],
          measurement: { materialId: item.materialId, defined: false },
          threshold: { requiredDefined: true },
          thresholdSource: 'product-concept-default',
          fix: 'Define the referenced material intent or assign a governed material to the item.',
        }));
      }
    }
  }

  const budget = project.brief?.budget || {};
  const budgetItems = Array.isArray(concept.budgetItems) ? concept.budgetItems : [];
  if (!budget.totalMinor || budget.confidence === 'unknown') {
    findings.push(issue(project, 'budget.unknown', 'warning', 'The project budget is not calibrated; cost output remains scope guidance only.', {
      fix: 'Record a target budget and estimate confidence before procurement decisions.',
    }));
  } else if (!budgetItems.length) {
    findings.push(issue(project, 'budget.scope-unallocated', 'blocking', 'A target budget exists but the selected concept has no scope allocation.', {
      measurement: { totalMinor: budget.totalMinor, currency: budget.currency },
      fix: 'Allocate the concept scope across demolition, construction, systems, finishes, fixtures, furniture, design, and contingency.',
    }));
  } else {
    const allocated = budgetItems.reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
    if (allocated > budget.totalMinor * 1.1) {
      findings.push(issue(project, 'budget.over-target', 'warning', 'Concept allocation exceeds the target budget by more than ten percent.', {
        measurement: { targetMinor: budget.totalMinor, allocatedMinor: allocated, currency: budget.currency },
        threshold: { maximumRatio: 1.1 },
        thresholdSource: 'product-concept-default',
        fix: 'Rebalance scope, quality level, contingency, or the target budget.',
      }));
    }
    for (const [index, rawItem] of budgetItems.entries()) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const valid = typeof item.budgetItemId === 'string' && item.budgetItemId.length > 0
        && typeof item.category === 'string' && item.category.length > 0
        && Number.isInteger(item.amountMinor) && item.amountMinor >= 0
        && ['verified', 'specified', 'estimated'].includes(item.confidence);
      if (!valid) {
        findings.push(issue(project, 'budget.item-incomplete', 'blocking', `Budget item ${item.budgetItemId || index + 1} lacks a stable category, amount, or estimate confidence.`, {
          nodeIds: item.budgetItemId ? [item.budgetItemId] : [],
          measurement: {
            hasId: Boolean(item.budgetItemId),
            hasCategory: Boolean(item.category),
            amountMinor: item.amountMinor ?? null,
            confidence: item.confidence ?? null,
          },
          threshold: { completeBudgetClassification: true },
          thresholdSource: 'product-concept-default',
          fix: 'Record a stable budget item ID, major category, non-negative minor-unit amount, and estimate confidence.',
        }));
      }
    }
    for (const scope of Array.isArray(project.brief?.scope) ? project.brief.scope : []) {
      if (budgetItems.some((item) => coversScope(item, scope))) continue;
      findings.push(issue(project, 'budget.scope-omitted', 'blocking', `The target budget does not allocate the recorded scope: ${scope}.`, {
        measurement: { scope, matchingBudgetItems: 0 },
        threshold: { minimumMatchingBudgetItems: 1 },
        thresholdSource: 'product-concept-default',
        fix: 'Map the scope to one or more budget items with scopeIds or an explicit scope label.',
      }));
    }
  }

  const schedule = project.brief?.schedule || {};
  if (!Array.isArray(schedule.phases) || !schedule.phases.length) {
    findings.push(issue(project, schedule.confidence === 'unknown' ? 'schedule.unknown' : 'schedule.scope-unallocated', schedule.confidence === 'unknown' ? 'warning' : 'blocking', 'No delivery phases are allocated for the recorded renovation scope.', {
      measurement: { scopeItems: Array.isArray(project.brief?.scope) ? project.brief.scope.length : 0, phases: 0, confidence: schedule.confidence || 'invalid' },
      threshold: { phasesRequiredWhenScheduleKnown: true },
      thresholdSource: 'product-concept-default',
      fix: 'Record demolition, construction, systems, finishes, fixtures, furniture, verification, or other project-specific phases.',
    }));
  }

  const verificationCategories = new Set((Array.isArray(project.professionalVerifications) ? project.professionalVerifications : []).map((entry) => entry?.category));
  if (!verificationCategories.has('site-measurement')) {
    findings.push(issue(project, 'safety.site-verification-missing', 'blocking', 'Site measurement verification is not recorded.', {
      fix: 'Add a required site-measurement professional verification before construction use.',
      professionalVerification: true,
    }));
  }
  const highRiskText = JSON.stringify({ decisions: project.decisions, scope: project.brief?.scope }).toLowerCase();
  for (const [pattern, category, label] of [
    [/structur|load-bearing|承重|开洞/, 'structure', 'structural work'],
    [/gas|燃气|烟道/, 'gas', 'gas or flue work'],
    [/waterproof|防水|排水/, 'waterproofing', 'waterproofing or drainage work'],
    [/electric|电气|回路/, 'electrical', 'electrical work'],
    [/fire|消防|疏散/, 'fire-safety', 'fire-safety work'],
  ]) {
    if (pattern.test(highRiskText) && !verificationCategories.has(category)) {
      findings.push(issue(project, `safety.${category}-verification-missing`, 'blocking', `The scope mentions ${label} without a matching professional verification.`, {
        fix: `Record a required ${category} verification by the applicable qualified professional.`,
        professionalVerification: true,
      }));
    }
  }
  return findings;
}

function coversScope(item, scope) {
  item = item && typeof item === 'object' ? item : {};
  const target = normalizeScope(scope);
  const explicit = [
    ...(Array.isArray(item.scopeIds) ? item.scopeIds : []),
    ...(Array.isArray(item.scope) ? item.scope : [item.scope]),
  ].filter(Boolean).map(normalizeScope);
  if (explicit.includes(target)) return true;
  return normalizeScope(`${item.category || ''} ${item.name || ''} ${item.summary || ''}`).includes(target);
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}
