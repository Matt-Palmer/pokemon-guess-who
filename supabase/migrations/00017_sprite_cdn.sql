-- Serve sprites from a CDN instead of raw.githubusercontent.com.
--
-- Every `pokemon.sprite_url` pointed at
-- `raw.githubusercontent.com/PokeAPI/sprites/...`. That host serves the right
-- files but is a source host, not an asset CDN: it rate-limits and redirects,
-- and a board asks for 24 sprites at once — precisely the burst it throttles.
-- The symptom was tiles rendering blank at random, with nothing logged, because
-- the client had no error handling on the image at all (now fixed in
-- `PokemonImage`, which retries and falls back to the card back).
--
-- jsDelivr fronts the identical repo with real CDN caching, so this is a host
-- swap and nothing else — same paths, same images, same ids.
--
-- Rewritten in place rather than re-seeded: the rest of each row (name, types,
-- generation) is unchanged, and this way the fix does not depend on anyone
-- re-running the seed script with a service-role key.
update public.pokemon
set sprite_url = replace(
  sprite_url,
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/',
  'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/'
)
where sprite_url like 'https://raw.githubusercontent.com/PokeAPI/sprites/master/%';
