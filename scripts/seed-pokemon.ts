/**
 * One-time seed: populates the `pokemon` reference table with all 1025 rows
 * from PokéAPI. Run with: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-pokemon.ts
 *
 * Uses PokéAPI's GraphQL endpoint to fetch id/name/types/generation for all
 * 1025 Pokémon in a single request, rather than 1025 individual REST calls.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type GraphQLPokemon = {
  id: number;
  name: string;
  pokemon_v2_pokemontypes: { pokemon_v2_type: { name: string } }[];
  pokemon_v2_pokemonspecy: { generation_id: number };
};

function artworkUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

async function fetchAllPokemon(): Promise<GraphQLPokemon[]> {
  const query = `query {
    pokemon_v2_pokemon(where: {id: {_lte: 1025}}, order_by: {id: asc}, limit: 1100) {
      id
      name
      pokemon_v2_pokemontypes { pokemon_v2_type { name } }
      pokemon_v2_pokemonspecy { generation_id }
    }
  }`;

  const res = await fetch('https://beta.pokeapi.co/graphql/v1beta2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { data } = await res.json();
  return data.pokemon_v2_pokemon;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const pokemon = await fetchAllPokemon();

  const rows = pokemon.map((p) => ({
    id: p.id,
    name: p.name,
    sprite_url: artworkUrl(p.id),
    types: p.pokemon_v2_pokemontypes.map((t) => t.pokemon_v2_type.name),
    generation: p.pokemon_v2_pokemonspecy.generation_id,
  }));

  const batchSize = 150;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('pokemon').upsert(batch);
    if (error) throw error;
    console.log(`Seeded ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
