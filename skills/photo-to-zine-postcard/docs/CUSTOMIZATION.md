# Customization Guide

The easiest way to create your own Photo to Zine Postcard variant is to fork the repository and modify `SKILL.md`.

The default style is deliberately constrained so that generations remain stable. When customizing, change one visual dimension at a time and keep the overall hierarchy intact.

## Keep these stable first

For the most reliable results, preserve:

- original photo as the primary visual anchor
- exact source-photo aspect ratio
- generous white space
- one main motif in the lower area
- one metadata block
- one unified postcard back

These constraints are more important than any specific illustration style.

## Good customization points

### 1. Hand-drawn style

Replace the default watercolor / gouache / ink language with another restrained treatment, for example:

- colored pencil
- graphite sketch
- Japanese watercolor
- risograph-like illustration
- flat cut-paper collage
- botanical plate drawing
- architectural line-and-wash

Do not let the new style create extra objects or a denser layout.

### 2. Motif selection

The default skill chooses the most visually attractive, source-defining feature.

You can specialize this for a project:

- landscape edition → prioritize horizon, mountain, coastline, water
- architecture edition → prioritize facade, window, roofline, structural silhouette
- botanical edition → prioritize flower, branch, leaf cluster
- street edition → prioritize signs, vehicles, storefronts, shadows

### 3. Palette

The default uses exactly three source-derived swatches:

1. dominant color
2. dark structural color
3. pale neutral / accent

You can change their shape or placement, but keeping the count low helps preserve the minimal composition.

### 4. Typography

Good directions include:

- restrained serif editorial
- neutral grotesk sans serif
- monospaced archival labels
- understated Japanese editorial typography

Avoid large slogans, long copy, or more than a few hierarchy levels.

### 5. Card ratio

Default: `2:3` portrait.

Possible variants:

- A6 (`105 × 148 mm`)
- landscape `3:2`
- square card
- panoramic photo edition

When changing the card ratio, keep the source photo’s own aspect ratio unchanged inside the card.

### 6. Back design

The default back is intentionally generic and functional. A custom series can change:

- divider position
- stamp-box style
- type treatment
- tiny watermark motif
- metadata placement

Do not reduce usable writing or address space.

## Recommended workflow for a new variant

1. Fork the repository.
2. Copy `SKILL.md` into a new variant file.
3. Change only one major design rule.
4. Test it on at least 8–12 different photo types.
5. Compare against the default skill for layout stability.
6. Only then add another customization.

## What usually makes generations unstable

Avoid combining too many optional instructions such as:

- multiple motif types
- many size ranges
- multiple independent collage clusters
- sample cards and texture grids
- optional decorative modules
- long typography specifications

A short, hierarchical skill generally performs better than a large visual checklist.

## Share your variant

If your variant is broadly useful, open a pull request and include example images showing the visual difference from the default style.
