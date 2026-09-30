import { StyleSheet, Text, View } from 'react-native';

import { PokemonImage } from '@/components/match/PokemonImage';
import { typeColors } from '@/constants/colors';
import { regionForGeneration } from '@/constants/regions';
import { PokemonCard } from '@/lib/matches';
import { colors, radii, spacing, type } from '@/ui';

/** The Pokédex number as a padded `#025`. */
const dexNumber = (id: number) => `#${String(id).padStart(3, '0')}`;

/**
 * Everything known about one Pokémon, on one surface: sprite, dex number, name,
 * types and region. Designed to sit inside a {@link CardModal}.
 *
 * A tile can only ever show one facet at a time (the board-wide `ViewToggle`
 * swaps between sprite, type and region), which is fine for scanning 24 cards
 * but not for the two moments that need the whole picture: choosing your secret,
 * and answering a question about the secret you hold. Both open this.
 */
export function CardDetail({ card }: { card: PokemonCard }) {
  return (
    <View style={styles.root}>
      <PokemonImage uri={card.sprite_url} style={styles.sprite} />
      <Text style={styles.dex}>{dexNumber(card.id)}</Text>
      <Text style={styles.name}>{card.name}</Text>

      <View style={styles.types}>
        {card.types.map((t) => (
          <View key={t} style={[styles.chip, { backgroundColor: typeColors[t] ?? colors.inkMuted }]}>
            <Text style={styles.chipText}>{t}</Text>
          </View>
        ))}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Region</Text>
        <Text style={styles.metaValue}>{regionForGeneration(card.generation)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Generation</Text>
        <Text style={styles.metaValue}>{card.generation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.xs },
  sprite: { width: 150, height: 150 },
  dex: { ...type.caption, fontWeight: '800', color: colors.inkFaint },
  name: { ...type.title, textTransform: 'capitalize' },
  types: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm, flexWrap: 'wrap' },
  chip: { borderRadius: radii.pill, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  chipText: { color: colors.onPrimary, fontWeight: '800', fontSize: 13, textTransform: 'capitalize' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metaLabel: { ...type.caption },
  metaValue: { ...type.label },
});
