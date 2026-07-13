import path from 'node:path';
import { emit, readJson, root } from './common.mjs';

export function runCatalog(options) {
  const catalog = readJson(path.join(root, 'registry', 'skills.json'));
  if (options.json) {
    emit(catalog, options);
    return;
  }

  const skillsByCategory = new Map();
  for (const skill of catalog.skills) {
    const list = skillsByCategory.get(skill.category) || [];
    list.push(skill);
    skillsByCategory.set(skill.category, list);
  }

  const lines = [];
  for (const category of [...catalog.categories].sort((a, b) => a.order - b.order)) {
    lines.push(category.label);
    for (const skill of (skillsByCategory.get(category.id) || []).sort((a, b) => a.name.localeCompare(b.name))) {
      const cli = skill.cli.length ? ` | cli: ${skill.cli.join(', ')}` : '';
      lines.push(`  - ${skill.name} [${skill.maturity}]${cli}`);
    }
    lines.push('');
  }
  console.log(lines.join('\n').trimEnd());
}
