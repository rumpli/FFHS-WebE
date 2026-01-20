/**
 * seed.ts
 *
 * Database seeding script for development. This script:
 * - Clears certain tables (inventories, deck cards, decks, card definitions)
 * - Inserts a curated set of `CardDefinition` rows used for local testing
 * - Creates a couple of example decks referencing those card definitions
 *
 * Usage: `node prisma/seed.js` (or via `prisma db seed` if configured)
 */

import {PrismaClient, CardType, CardRarity} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log(">>> SEED START");
    // Remove previous seeded data to ensure idempotent runs during development
    await prisma.cardInventory.deleteMany();
    await prisma.deckCard.deleteMany();
    await prisma.deck.deleteMany();
    await prisma.cardDefinition.deleteMany();

    // Insert canonical card definitions used by the client for local dev
    await prisma.cardDefinition.createMany({
        data: [
            {
                id: "goblin_raid",
                name: "Goblin Raid",
                description: "Many, but weak goblins.",
                image: "/assets/goblinraid.png",
                type: CardType.ATTACK,
                rarity: CardRarity.COMMON,
                cost: 2,
                baseDamage: 10,
                baseHpBonus: null,
                baseDpsBonus: null,
                buffMultiplier: null,
                config: {
                    enemies: 8,
                    enemyType: "goblin",
                    damagePerEnemy: 2,
                },
            },
            {
                id: "ogre_assault",
                name: "Ogre Assault",
                description: "Few, but strong ogres.",
                image: "/assets/ogreassault.png",
                type: CardType.ATTACK,
                rarity: CardRarity.RARE,
                cost: 4,
                baseDamage: 30,
                baseHpBonus: null,
                baseDpsBonus: null,
                buffMultiplier: null,
                config: {
                    enemies: 3,
                    enemyType: "ogre",
                    damagePerEnemy: 15,
                },
            },
            {
                id: "reinforced_walls",
                name: "Reinforced Walls",
                description: "To the walls!",
                image: "/assets/reinforcedwalls.png",
                type: CardType.DEFENSE,
                rarity: CardRarity.COMMON,
                cost: 3,
                baseDamage: null,
                baseHpBonus: 20,
                baseDpsBonus: null,
                buffMultiplier: null,
                config: {
                    kind: "hp_permanent",
                },
            },
            {
                id: "improved_ballista",
                name: "Improved Ballista",
                description: "Bigger, better, ballista.",
                image: "/assets/improvedballista.png",
                type: CardType.DEFENSE,
                rarity: CardRarity.UNCOMMON,
                cost: 3,
                baseDpsBonus: 5,
                baseDamage: null,
                baseHpBonus: null,
                buffMultiplier: null,
                config: {
                    kind: "dps_permanent",
                },
            },
            {
                id: "battle_frenzy",
                name: "Battle Frenzy",
                description: "Warrior's adrenaline surge.",
                image: "/assets/battlefrenzy.png",
                type: CardType.BUFF,
                rarity: CardRarity.UNCOMMON,
                cost: 2,
                baseDamage: null,
                baseHpBonus: null,
                baseDpsBonus: null,
                buffMultiplier: 1.2,
                config: {
                    target: "next_attack",
                },
            },
            {
                id: "fortified_focus",
                name: "Fortified Focus",
                description: "A calm, meditative tactic\n" +
                    "that steadies\n" +
                    "resolve and sharpens purpose.",
                image: "/assets/fortifiedfocus.png",
                baseDamage: null,
                baseHpBonus: null,
                baseDpsBonus: null,
                type: CardType.BUFF,
                rarity: CardRarity.RARE,
                cost: 2,
                buffMultiplier: 1.3,
                config: {
                    target: "next_defense",
                },
            },
            {
                id: "dragon_covenant",
                name: "Dragon Covenant",
                description: "There are dragons.",
                type: CardType.BUFF,
                rarity: CardRarity.LEGENDARY,
                image: "/assets/dragoncovenant.png",
                cost: 7,
                baseDamage: null,
                baseHpBonus: null,
                baseDpsBonus: null,
                buffMultiplier: 1.5,
                config: {
                    target: "all_attacks_next_round",
                },
            },
            {
                id: "marry_proposal",
                name: "The Ultimatum",
                description: "Silence has a price.",
                type: CardType.BUFF,
                rarity: CardRarity.EPIC,
                image: "/assets/willyoumarryme.png",
                cost: 7,
                baseDamage: null,
                baseHpBonus: null,
                baseDpsBonus: null,
                buffMultiplier: null,
                config: {
                    target: "marry_proposal",
                },
            },
            {
                id: "gold_mine",
                name: "Gold Mine",
                description: "Diggy, diggy, gold!",
                image: "/assets/goldmine.png",
                type: CardType.ECONOMY,
                rarity: CardRarity.COMMON,
                cost: 3,
                config: {
                    kind: "gold_per_round",
                    goldPerRound: 2,
                },
            },
            {
                id: "arcane_insight",
                name: "Arcane Insight",
                description: "Insightful draws next round.",
                image: "/assets/arcaneinsight.png",
                type: CardType.ECONOMY,
                rarity: CardRarity.UNCOMMON,
                cost: 3,
                config: {
                    kind: "extra_draw_next_round",
                    extraDraw: 2,
                },
            },
            {
                id: "marry_refusal",
                name: "Refusal",
                description: "Pay the price to refuse,\n" +
                    "or lose instantly\n" +
                    "after the battle.",
                image: "/assets/willyoumarryme_no.png",
                type: CardType.DEFENSE,
                rarity: CardRarity.COMMON,
                cost: 5,
                collectible: false,
                config: {
                    target: "marry_refusal"
                }
            }

        ],
    });
    console.log("Seeded CardDefinition table.");

    // Create two example decks referencing the seeded card definitions
    const attackDeck = await prisma.deck.create({
        data: {
            name: "Attack Deck",
            cards: {
                create: [
                    {cardId: "goblin_raid", copies: 1, slotIndex: 0},
                    {cardId: "ogre_assault", copies: 1, slotIndex: 1},
                    {cardId: "battle_frenzy", copies: 1, slotIndex: 2},
                    {cardId: "reinforced_walls", copies: 1, slotIndex: 3},
                ],
            },
        },
    });

    const defenseDeck = await prisma.deck.create({
        data: {
            name: "Defense Deck",
            cards: {
                create: [
                    {cardId: "reinforced_walls", copies: 1, slotIndex: 0},
                    {cardId: "improved_ballista", copies: 1, slotIndex: 1},
                    {cardId: "fortified_focus", copies: 1, slotIndex: 2},
                    {cardId: "goblin_raid", copies: 1, slotIndex: 3},
                ],
            },
        },
    });
    console.log("Seeded Deck table:", {attackDeckId: attackDeck.id, defenseDeckId: defenseDeck.id});
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
