const STYLE_PROFILES = Object.freeze([
  profile('warm-mineral-walnut', '温润胡桃',
    ['#f1ede6', '#ded7cd', '#c4aa82', '#6d4734', '#282522', '#d7c9b9', '#567c68', '#9b7b52'],
    ['暖灰矿物墙面', '自然胡桃木', '亚麻软装', '低饱和鼠尾草绿'],
    'warm mineral contemporary interior, natural walnut joinery, soft limestone, linen upholstery, restrained sage accents, editorial architectural photography',
    'cold blue cast, orange wood, glossy plastic, excessive gold, clutter'),
  profile('cream-quiet-luxury', '奶油轻奢',
    ['#f7f1e6', '#eee2d0', '#d9c29c', '#a8835d', '#463b35', '#e7d9c5', '#9f795f', '#bd9a62'],
    ['奶油微水泥', '浅烟熏木', '羊羔绒与皮革', '克制黄铜'],
    'quiet luxury cream interior, limewash walls, pale smoked oak, boucle and leather, subtle brushed brass, soft sculptural furniture, premium editorial lighting',
    'gaudy gold, hotel lobby excess, pure white clipping, glossy marble everywhere, clutter'),
  profile('wabi-sabi-oak', '侘寂原木',
    ['#eee9de', '#d9d0c0', '#bda77f', '#8d6c48', '#39362f', '#d5c8b3', '#77806b', '#8d7659'],
    ['手作灰泥', '原生橡木', '棉麻与藤编', '苔绿陶器'],
    'wabi sabi oak interior, handmade plaster, natural oak, linen and rattan, imperfect ceramics, calm daylight, tactile understated atmosphere',
    'luxury marble, chrome, saturated colors, perfect symmetry, decorative clutter'),
  profile('modern-charcoal', '现代深色',
    ['#dadbd7', '#babcb7', '#77726d', '#49372f', '#171c1b', '#797b78', '#356554', '#353938'],
    ['暖灰艺术漆', '烟熏木', '深灰织物', '黑钛金属'],
    'modern charcoal interior, warm grey plaster, smoked timber, dark tailored upholstery, blackened metal details, controlled contrast, cinematic architectural lighting',
    'crushed blacks, blue office lighting, all-black surfaces, neon accents, clutter'),
]);

function profile(styleId, label, colors, materials, promptPrefix, negativePrompt) {
  const [backdrop, plaster, floor, wood, darkWood, fabric, accent, metal] = colors;
  return {
    styleId, label,
    palette: { backdrop, plaster, floor, stone: floor, wood, darkWood, fabric, accent, metal, plant: accent },
    materials,
    lighting: {
      ambientColor: styleId === 'modern-charcoal' ? '#f1e6d6' : '#fff5e7',
      keyColor: styleId === 'modern-charcoal' ? '#f5d8bd' : '#fff0d5',
      skyColor: '#e8f0eb', groundColor: '#82786c', exposure: styleId === 'modern-charcoal' ? 1.08 : 1.16,
      ambientScale: styleId === 'modern-charcoal' ? 0.82 : 1.04,
      keyScale: styleId === 'modern-charcoal' ? 1.18 : 1.02,
    },
    imageGeneration: {
      promptPrefix,
      negativePrompt,
      consistencyRules: ['lock floor-plan geometry', 'preserve openings and circulation', 'use the same palette, material families, lighting temperature, and soft-furnishing language'],
    },
  };
}

export function resolveInteriorStyleGuide(project, scenePayload) {
  const governed = project.demandWorkflow?.styleProfile?.primary || {};
  const confirmedId = governed.styleId || STYLE_PROFILES[0].styleId;
  const known = STYLE_PROFILES.find((entry) => entry.styleId === confirmedId);
  if (!known) throw new Error(`unsupported interior styleId: ${confirmedId}; query the renderer style catalog before rendering`);
  const selected = {
    ...known,
    styleId: confirmedId,
    label: governed.label || known.label,
    observable: governed.observable || {},
    borrow: governed.borrow || [],
    avoid: governed.avoid || [],
  };
  return {
    schema: 'personal-agent/interior-style-guide/v1',
    revision: project.revision,
    sceneHash: scenePayload.sceneHash,
    selection: {
      selectedStyleId: confirmedId,
      status: governed.status || 'candidate',
      source: 'demandWorkflow.styleProfile.primary',
      pagePresentation: 'selected-style-only',
      persistence: 'Agent must create a governed project revision before effect-render generation',
    },
    selected,
    effectRenderBinding: {
      styleId: confirmedId,
      promptPrefix: selected.imageGeneration.promptPrefix,
      negativePrompt: selected.imageGeneration.negativePrompt,
      consistencyRules: selected.imageGeneration.consistencyRules,
      requiredProvenance: ['styleId', 'styleGuideSha256', 'sceneHash', 'cameraId', 'promptSha256'],
      onStyleFeedback: 'update demandWorkflow.styleProfile.primary, mark older renders stale, compile, render Page, inspect, then regenerate effect renders',
    },
    agentInspection: {
      required: true,
      inspect: ['rendered 3D uses the selected style materials, lighting, and soft furnishings', 'selected styleId matches effect-render prompts', 'desktop, forced-landscape portrait, and native landscape remain legible'],
      correctionSurface: 'governed project data and style profile only',
    },
  };
}

export function interiorStyleProfiles() {
  return structuredClone(STYLE_PROFILES);
}
