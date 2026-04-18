# Decompose Variant: Recipe

Load this prompt when processing a file with `categorized_as: recipe`.
Combine with the shared mechanics in the decompose agent (step 5).

## Epistemic stance

High trust for ingredients and techniques. Recipes are prescriptive
documents — the author is asserting "this works." Treat procedural
content as reliable.

## Extraction priorities

Focus on `entity-update` and `new-entity` claims. Recipes primarily
introduce ingredients, techniques, equipment, and their relationships.

## Variant-specific guidance

- Each recipe SHOULD produce a `new-entity` claim for the dish itself
  (target_type: concept or whatever schema you use for recipes)
- Key ingredients become `relationship` claims linking the dish to
  the ingredient entity
- Cooking techniques (braising, sous vide, fermentation) become
  `entity-update` or `new-entity` claims as concepts
- Yield, timing, and temperature data become `entity-update` claims
  on the dish entity — these are factual attributes
- Author opinions ("this is the best way to...") become `signal` claims
- Substitution suggestions become `relationship` claims between
  ingredients
- Equipment requirements become `relationship` claims linking the dish
  to equipment entities

## What to skip

- Step-by-step procedural instructions (extract the capability, not
  the steps — "requires 45-minute braise" not "step 3: place in oven")
- Decorative language and storytelling preambles
- Serving suggestions unless they introduce a meaningful pairing
