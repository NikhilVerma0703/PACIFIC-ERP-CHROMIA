-- =====================================================================
-- NEON-02-data.sql   THE COLOUR CATALOGUE
--
-- Pacific Surfaces — fabrication + sampling, 2026-08-25.
-- Run this SECOND, after NEON-01-schema.sql.
--
-- WHAT THIS IS
-- The colour chart, as master data: 7 series, 129 colours, and every colour
-- in all four finishes — Polished, Suede, Matte, Leathered.
--
-- Sample stock is counted against a COLOUR AND A FINISH, never a colour
-- alone ("50 Carrara Royale 11x11" is not a stock figure until you know it
-- is suede). So a colour that is not in here cannot have stock counted
-- against it, and a finish that is not in here cannot be asked for.
--
-- WHY ALL FOUR FINISHES ON EVERY COLOUR
-- The printed chart only ever listed the finish variants somebody had
-- photographed — three lines out of 132. Seeding only those left Carrara
-- Royale with a Polished row and nothing else, and the sample form could
-- then offer nothing else. The shop can cut any colour in any of the four
-- on request, so all four exist. A row with no stock against it costs
-- nothing: the inventory screen hides empty shelves by default.
--
-- SAFE TO RE-RUN. Every statement is an upsert keyed on the natural name —
-- series name, colour name, colour+finish. Running it twice changes nothing
-- and never duplicates.
--
-- CORRECTIVE. A colour re-classified into the wrong series by hand moves
-- back to the series the chart says, and positions are re-numbered.
--
-- IDs ARE DETERMINISTIC (md5 of the name), so the same row keeps the same id
-- on every run and across every environment. That is deliberate: the tables
-- have no id default — Prisma normally generates one client-side — so raw
-- SQL has to supply it, and a random one would create a new row on re-run.
--
-- ORDER MATTERS: run the finish-rename in NEON-01 BEFORE this. This file
-- writes "Leathered" and "Matte"; if it runs first, the rename finds nothing
-- left to rename and any older "Leather" / "Honed" rows survive alongside —
-- two spellings, two shelves, one physical finish.
-- =====================================================================

BEGIN;

-- 7 series
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('72784233b372144a5c0f7bf1286d1497', 'Aurora', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('206a54ebad51467c03105e9e5e5a0fa8', 'Solids', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('21a7113ca11463e03c6250aaa6de09de', 'Luminara', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('ac3ae6912d349513ffc3e8cb0142a601', 'Nebula', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('8a3cc5715a053bb60a98529eed4629ae', 'Celestia', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Kosmic', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_series" ("id","name","position","updated_at") VALUES ('bf1ca93a71bbe48c85dda5a638cbfd1a', 'Eclipse', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;

-- 129 colours
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('4dd01d3b73f8555909401594dbff3fbe', '72784233b372144a5c0f7bf1286d1497', 'Echo White', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('aaf2d8e3bff97ff577c86769f888120b', '72784233b372144a5c0f7bf1286d1497', 'Arva White', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b3590ab9e2dbd00686e24a52a3caeaf0', '72784233b372144a5c0f7bf1286d1497', 'Cemento', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7ba670dd9e58d2679d292d46a60bf06d', '72784233b372144a5c0f7bf1286d1497', 'Classic Gray', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('16837c918971ffa06af0221b38164a5b', '72784233b372144a5c0f7bf1286d1497', 'Pebbles Ice', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b03d23afed84912f7a58621586f04e88', '72784233b372144a5c0f7bf1286d1497', 'Star Cluster', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('4fe82c0b4f5d3a82fe36dc22d72b7b01', '72784233b372144a5c0f7bf1286d1497', 'White Blizzard', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('67efb84eefe2a5b13135ee403162f445', '72784233b372144a5c0f7bf1286d1497', 'Ultima White', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('64e6f058b2ef0a33b141347072dd0d49', '206a54ebad51467c03105e9e5e5a0fa8', 'Brilliant White', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7cb3d0d9487483aea74d490affe7d884', '206a54ebad51467c03105e9e5e5a0fa8', 'Super White', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('56f536466638579d9dbf5191ef848703', '21a7113ca11463e03c6250aaa6de09de', 'Mystique', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e31cc50fca2afc027caf55edbae86a73', '21a7113ca11463e03c6250aaa6de09de', 'Oasis', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('359f2f809c45e3e2c2926b785a08e1fb', '21a7113ca11463e03c6250aaa6de09de', 'Zenith', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('31ceccec4fd8be0b59d2bd4c4b07a1dc', 'ac3ae6912d349513ffc3e8cb0142a601', 'Alabaster', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('bc917a1954e9352f1b8a59e5daaafef3', 'ac3ae6912d349513ffc3e8cb0142a601', 'Alabaster Noir', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('30c621db1aa1a5e2c507248ad7f51611', 'ac3ae6912d349513ffc3e8cb0142a601', 'Alchemy', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7b1d6723f08255361df3d37621cda45e', 'ac3ae6912d349513ffc3e8cb0142a601', 'Antonio', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('65cec7ad1a1a5acf39b3ecaa11f5fa12', 'ac3ae6912d349513ffc3e8cb0142a601', 'Arena', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('80ee78967dd88f2fd170dc91fb682adc', 'ac3ae6912d349513ffc3e8cb0142a601', 'Arya Pearl', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('57cac8f843a1ecda644a24441e59f19d', 'ac3ae6912d349513ffc3e8cb0142a601', 'Atlantis', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('ec5881cae07271e0efcd72595f599e84', 'ac3ae6912d349513ffc3e8cb0142a601', 'Aureate', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('0995b5858b7dd64b69c0631aa502ac33', 'ac3ae6912d349513ffc3e8cb0142a601', 'Banyan', 8, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2eb0248fd603083dad8c66e1dfb21efb', 'ac3ae6912d349513ffc3e8cb0142a601', 'Bellagio', 9, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7cc5e1a461fd37ae677996ae7ea85fc0', 'ac3ae6912d349513ffc3e8cb0142a601', 'Belleza', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('715cbf9c8be4e45d7c99c945813e8d9c', 'ac3ae6912d349513ffc3e8cb0142a601', 'Bohemia', 11, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e45913261a7d590074e53e929ab661ec', 'ac3ae6912d349513ffc3e8cb0142a601', 'Breeze', 12, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('141fb97c4ccb0abe9a52f432d1f65a94', 'ac3ae6912d349513ffc3e8cb0142a601', 'Cleopatra', 13, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2982a39137ef269dad9ba71a91c007c3', 'ac3ae6912d349513ffc3e8cb0142a601', 'Cosmopolitan', 14, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('27b4e1a4bf860d5afabbdfc51ebc2f38', 'ac3ae6912d349513ffc3e8cb0142a601', 'Costa', 15, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('67b9328f1fc29e22e7d380b9328a5a22', 'ac3ae6912d349513ffc3e8cb0142a601', 'Dazzle', 16, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('5a26415e5628839c4fc80154c759316a', 'ac3ae6912d349513ffc3e8cb0142a601', 'Elvis', 17, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('ce643ed453cc12f4151d898c0d1030f7', 'ac3ae6912d349513ffc3e8cb0142a601', 'Eminence', 18, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('bd75179eb6f083c4a8f0c0ffdbf4de1a', 'ac3ae6912d349513ffc3e8cb0142a601', 'Fern', 19, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b23e964f3cccefb3ab15f907c3e8d988', 'ac3ae6912d349513ffc3e8cb0142a601', 'Hazel Gold', 20, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('f44e14ba45823475703eae1f579f6b31', 'ac3ae6912d349513ffc3e8cb0142a601', 'Hermes', 21, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('cc6ce3f624fef2d84b3d4b01dfc3b4b2', 'ac3ae6912d349513ffc3e8cb0142a601', 'Honeydew', 22, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('94cefd1cf9c0404300298c85393d491a', 'ac3ae6912d349513ffc3e8cb0142a601', 'Ibiza', 23, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('f051e332a973b1ea6cea9ce295b870dd', 'ac3ae6912d349513ffc3e8cb0142a601', 'Ikos', 24, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('5e35d68e5abb8f4e2ef07330804b6aaa', 'ac3ae6912d349513ffc3e8cb0142a601', 'Iris Blue', 25, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('cd52a19cd57902b123a4612e093d5372', 'ac3ae6912d349513ffc3e8cb0142a601', 'Iris Gray', 26, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2963a0b9267fc0236701cda306353d10', 'ac3ae6912d349513ffc3e8cb0142a601', 'Tramento', 27, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('3f1b8e9368e133ec1ee5d7a557542b07', 'ac3ae6912d349513ffc3e8cb0142a601', 'Ashford', 28, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('4fb925e1a770ef60d050c2b74b567aa1', 'ac3ae6912d349513ffc3e8cb0142a601', 'Artemis', 29, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('a243ab5f6b545b431c6256d7fac0fe5d', 'ac3ae6912d349513ffc3e8cb0142a601', 'Glacial Silver', 30, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('57c5c569836ea256e87de0f45192c08f', 'ac3ae6912d349513ffc3e8cb0142a601', 'Deepwave', 31, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('9f54ef9ab2aac967e7b0466a766ae2a8', 'ac3ae6912d349513ffc3e8cb0142a601', 'Soft Veil', 32, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('3c93e20875dd2f3d982a4e04ef3fafde', 'ac3ae6912d349513ffc3e8cb0142a601', 'Venetia', 33, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('9c57633e776d23a3524282718b88cbc2', 'ac3ae6912d349513ffc3e8cb0142a601', 'Caterina', 34, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('d5864ede137992b6ddbe39150159625f', 'ac3ae6912d349513ffc3e8cb0142a601', 'Arya', 35, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b7de2d9b3f024c83e650c08c4502a208', 'ac3ae6912d349513ffc3e8cb0142a601', 'Artemis Grey/Deepwave', 36, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b7409388beb58f5221d58e48e108aca1', '8a3cc5715a053bb60a98529eed4629ae', 'Stella', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('eae82dd69bf6d8804502066171aac67e', '8a3cc5715a053bb60a98529eed4629ae', 'Seasons', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('264676e918df895f9e1f21de02c09c11', '8a3cc5715a053bb60a98529eed4629ae', 'Wintersky', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('0b0eb8b62a2281af1bafcf6caec5c87f', '8a3cc5715a053bb60a98529eed4629ae', 'Silken', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('11645b5b71d771b4ffb36c27b38d7abc', '8a3cc5715a053bb60a98529eed4629ae', 'Desert Brown', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('02a279094e8f7273fd9b154cb5262a2d', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Aspen Aura', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('85b5a1878b19fefebc2cb4919b4baafd', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Coastal Pearl', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('44d627a229d5385d3f19e6173bf17c5b', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Driftwood', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('ec3b4f03b2cc56aad4577a9013616d07', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Franklin', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7b9f3372167720ab8704dc2345eb9d8b', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Galactic Halo', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('26d3c6b44637634379aba1b888f348e9', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Golden Dawn', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('a00eae9116c3530862354bc846bc8ea1', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Havelock', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('00e79b49d657e0162bb2984ee7a2aecc', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Irish Cream', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e5aca7b2419d389312a2c784d82f2125', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Nestos', 8, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2f992cae7bd58ebbc297133043a3d85a', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Oakville', 9, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('f690f5680829ac2a70bbf21fc114ed2e', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Ruskin', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('611967215d9765a43e550949c1e2a864', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Stellar Ember', 11, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('39e03f771165a13a314efa92e7b222ca', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Suzuka', 12, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('d79b1f3a77d415dba4b566c4fbb84d1e', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Tokyo', 13, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('65f4ff0e3ea3ecb8bfae2f90aedaa52b', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Venus Glow', 14, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e01be61cdcd3a2d0086256df4a0622ae', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Latte Luxe', 15, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('cf84da90eadb602fe95ea016d6f6f600', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Venice', 16, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('193cfa592d389dafd77a1571c7b7b668', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Mockingbird', 17, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('451e099aed1b33605b38e2589b8cd604', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Kandice', 18, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b1d989603bc70b09d69e2bf134530f65', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Skyline', 19, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('5314a9da3c0d743f64a63a08179b452b', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Larvik', 20, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e4d1c7fb4b59df43673c3b3ede7e7062', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Adonis', 21, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('5516e6f99027268c411016c94e6f6200', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Alps', 22, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('258dfa7063c2b38da365c94dcd8c1511', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Medusa', 23, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('813d032cdff6404ec315252a3a410bd8', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Merlot', 24, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('66b3d96d541cd9aa705aea9e130b7a18', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'French Vanilla', 25, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('f96cd71823456444e5d1deb3e4fb8ed2', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Florence', 26, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('692c2be762e761f53d2a36605aa1b0c6', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Cherry Hill', 27, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('a7d95635067995135dc4e49efce17e64', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Walnut', 28, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('0289d6268866fdf2d956eb834829a884', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'San Marino', 29, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('388b59ec7cefb0f6f49595e464e50602', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Paradise City', 30, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('0716aa3c40b16aad43279e092a84611c', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Valencia', 31, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('3977813da4a892c17c18d69fcbcff2df', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Venezia', 32, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('fc0d20d9946564f9fee46c5381a28cb5', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Havana', 33, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b0bc358a7c9686d284c4d20aaabdd488', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Matcha Mist', 34, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('d6da18043a12854fd753db32dee31abc', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Sakura', 35, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('85b82933a14c350f7975846963262803', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Astral Mist', 36, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e2f4920ac512743010795f17d47a3f9f', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Bianco Cristallo', 37, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('c0a9bc85b38f344732925635b20102c8', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Cappuccino', 38, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('4bc8bb70234e6fdce3f2c0a16424a2c0', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Maple Gaze', 39, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('d470e8e528000f4da2b163cde131527a', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Poseidon', 40, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b4f60dae31aa2e7f28e19b6a8a9da10c', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Wakanda', 41, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7ddc41e04f341cc46bca20c7f55fa51c', 'b1633c1ac52e5e2eba6efc2b5d9eaebd', 'Cappuccino Dark', 42, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('3e903a386a50d5f812116265180d7c1e', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Taj Vein', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('baab81beca97aab6cce1c0c42d1f2254', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Mintara', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('349a69bdec0fd9e725bafe8222117c6a', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Elano', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('6737df0219b6a89ec0a56ef5817866a7', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Elvion', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('c865e179a99b78728e24b82a12a5ef46', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Arlina', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('708b6f371bd64c5b47a0987af3cdbe66', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Rovena', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('62bcf817eaeb3121c463565fac63551f', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Mirano', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2333ddca761645954325eced511373f7', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Linera', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('f75c30cc43ef711451fd1c1839d5fac0', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Orva', 8, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('b06be3bda947d798cb61e80d93261213', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Almond Mist', 9, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('98bd758881d050d9c9c84328e2d3411b', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Cascade', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('153c5c8c69508b8d1e6121d625aa45d6', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Winter Haze', 11, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('3ac74d4daa42001d49d3ee748b30e0e6', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Stone Lily', 12, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('c423dbe3d68a635c88b8e39829a9a621', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Himalayan Vein', 13, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('5d9d9432a157dff65cd1ca7c5f691bc8', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Crimson Flow', 14, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('409501db5f064aa75f3978247a2eeb29', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Snowveil', 15, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('ff74007b7c0157f6fc3fc18d33ff8774', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Silver Haven', 16, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('04e5abe47ea3d86e339d92b7981b2a8d', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Frost Vein', 17, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e5ce3cfd65222f5096b8c500248d943a', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Cinder Flow', 18, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2c3eaad44b4b78c48532e9ed786940dd', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Silverscape', 19, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('7d9bf0a55eb4496019b9e7c6dd75e19c', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Ashen Bloom', 20, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('13a69c5ab23a19dbc630d73bb6cec6b8', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Horizon Veil', 21, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('d92d0acec196aa4771db2501849e0b46', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Mossline', 22, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('c3cf3340fcd056cb8df14707319d1390', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Velluto', 23, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('2c5a643f90a665ade8916e6de133d2f4', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Orenda', 24, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('4c209ac9202eb94c9fbd8f13ed259ea9', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Mossveil', 25, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('c2d433a7bd7f1f70b3803efeff73864d', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Lumina Cristal', 26, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('598f41679cabca7cf908d93acc3d8a12', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Artemis Grey', 27, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('6606d9cfb34bb1037fa7cb13ced60ef0', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Patagonia', 28, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e75126c64c62c4cc445dbed4997d7722', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Tiffany', 29, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
INSERT INTO "product_colour" ("id","series_id","name","position","updated_at") VALUES ('e83b62abb5efbf9b4dc546c5cf4b569c', 'bf1ca93a71bbe48c85dda5a638cbfd1a', 'Statuario', 30, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET "series_id" = EXCLUDED."series_id", "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;

-- 129 colours x 4 finishes = 516 rows
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7c8799f101bf968197fc69bc927b4f87', '4dd01d3b73f8555909401594dbff3fbe', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9b5037dccec55ab39949a644dbc7dec6', '4dd01d3b73f8555909401594dbff3fbe', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ead8a49335dbd1e11debc8de5331ecfc', '4dd01d3b73f8555909401594dbff3fbe', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('60454327707ad7a3d7859ec0fe8cf4ce', '4dd01d3b73f8555909401594dbff3fbe', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('13b887aa17b9c3d7444b8cbc67ae0f00', 'aaf2d8e3bff97ff577c86769f888120b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8dc4fee3e0eb1fd932fb033c2784d169', 'aaf2d8e3bff97ff577c86769f888120b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('78e450efb59d755d5113125cdf3f418a', 'aaf2d8e3bff97ff577c86769f888120b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('04ae7e4dda27e697a38740a0b6f1cd51', 'aaf2d8e3bff97ff577c86769f888120b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1b24a17cfe987224d75ff7e26fdfa463', 'b3590ab9e2dbd00686e24a52a3caeaf0', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a18ec32382a5f13382b4504dad79f0cb', 'b3590ab9e2dbd00686e24a52a3caeaf0', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('32765fe81976385771d73cbcdb111b39', 'b3590ab9e2dbd00686e24a52a3caeaf0', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('839667951f61d9a5ccd5248221d9e422', 'b3590ab9e2dbd00686e24a52a3caeaf0', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3ac7d6566e25c0d3cc39f91dcaa07821', '7ba670dd9e58d2679d292d46a60bf06d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('36265f8b0b4267775aff9042bbb2cf95', '7ba670dd9e58d2679d292d46a60bf06d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('86f0574f0bce81aea7be47f98bbb8ecf', '7ba670dd9e58d2679d292d46a60bf06d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a35e2b3bac82f7183c171a867c05f30f', '7ba670dd9e58d2679d292d46a60bf06d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f9ec437337d79b81e7fcb44bc6aee8a6', '16837c918971ffa06af0221b38164a5b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0f20f8d80d7e3d3b54bf4bd152f486f1', '16837c918971ffa06af0221b38164a5b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a01aae55c147739fdc19fdc1547c509a', '16837c918971ffa06af0221b38164a5b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bfd96d86ce4a5048bd0fe3c499360271', '16837c918971ffa06af0221b38164a5b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('958a9ad18cfd392edb4244fb54b88eab', 'b03d23afed84912f7a58621586f04e88', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cc517f52dd5837d78ede67eb3360d2dc', 'b03d23afed84912f7a58621586f04e88', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2ecd67db4371aad5225561c2b11c0ea1', 'b03d23afed84912f7a58621586f04e88', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('52b5101981a76b58a881d252db615ff4', 'b03d23afed84912f7a58621586f04e88', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d5455540172918cb2807c582e3a934d1', '4fe82c0b4f5d3a82fe36dc22d72b7b01', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b1fc2d6646d4800a12eee77b4b4a9441', '4fe82c0b4f5d3a82fe36dc22d72b7b01', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('22e55974e9b73ab3842e8318739ab1d8', '4fe82c0b4f5d3a82fe36dc22d72b7b01', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e32d8449e21655f7a34cbda5e6ec940', '4fe82c0b4f5d3a82fe36dc22d72b7b01', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('129e53752d830c3f507c49f0acc45102', '67efb84eefe2a5b13135ee403162f445', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8087ad7124549e086220f33e4ff76fe5', '67efb84eefe2a5b13135ee403162f445', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b4e753801bde3b87c8b0c4d1b099524d', '67efb84eefe2a5b13135ee403162f445', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('046b5b78c3e55fc9d7ab1b708de1db8d', '67efb84eefe2a5b13135ee403162f445', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0002d85ea786dd955cd6fe8814089c39', '64e6f058b2ef0a33b141347072dd0d49', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('74e2a4ded7c4688aa66c9b7da66fae0f', '64e6f058b2ef0a33b141347072dd0d49', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5a6acbf75a85d8b6c98e3c98c8b1cfa4', '64e6f058b2ef0a33b141347072dd0d49', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('732da7adfd507b53eb1b18d42aa275a6', '64e6f058b2ef0a33b141347072dd0d49', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3d9bc4436617f22e2e2a2df727c6966f', '7cb3d0d9487483aea74d490affe7d884', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('be24e1afc008e679236195ded63691d5', '7cb3d0d9487483aea74d490affe7d884', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2838179958972fb8d9f2199683e4c906', '7cb3d0d9487483aea74d490affe7d884', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d1615a4b52ca342b57d4c87fdf3b2683', '7cb3d0d9487483aea74d490affe7d884', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('67d967983e8dc5b803fe5cc16e4f2f5d', '56f536466638579d9dbf5191ef848703', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f402236de057aeca6bc867e09304f04e', '56f536466638579d9dbf5191ef848703', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('39d04de8ea1387b649cdb55e0a6d39a2', '56f536466638579d9dbf5191ef848703', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b312eb770a4584180c8c8bc46b093cd9', '56f536466638579d9dbf5191ef848703', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fa5e58ff4b668c323993772645657d5c', 'e31cc50fca2afc027caf55edbae86a73', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8e0a72c3786f1fc67c21a1cb55a6c512', 'e31cc50fca2afc027caf55edbae86a73', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2001b45c899668fa931491d94db3deca', 'e31cc50fca2afc027caf55edbae86a73', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f70267ebb7f7893154d19ef9700a6313', 'e31cc50fca2afc027caf55edbae86a73', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('337102ef8ef447cf4373cba403f7fa28', '359f2f809c45e3e2c2926b785a08e1fb', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('17fd3d4151d1f94caf2288cde718cf6d', '359f2f809c45e3e2c2926b785a08e1fb', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6d2180d770c533117056c886293f8718', '359f2f809c45e3e2c2926b785a08e1fb', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('607a1bbef6b5c165bc9365cbc32c02de', '359f2f809c45e3e2c2926b785a08e1fb', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('500e9ba393c5ffed37ae4d6cccbfee1f', '31ceccec4fd8be0b59d2bd4c4b07a1dc', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2cc5b98eecc9ac4359e6037180ec3290', '31ceccec4fd8be0b59d2bd4c4b07a1dc', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('40b141ab4f14da6f0064a541cad23af4', '31ceccec4fd8be0b59d2bd4c4b07a1dc', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8b7e19266bd41831f5db7dc8ef3e57f9', '31ceccec4fd8be0b59d2bd4c4b07a1dc', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('80eed88e2f83f974ecdaa9dad4bc8b39', 'bc917a1954e9352f1b8a59e5daaafef3', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('04023e24ac12c9990d6c8f9b53d7a942', 'bc917a1954e9352f1b8a59e5daaafef3', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ec2544d9c0b1111f6353294f619182b5', 'bc917a1954e9352f1b8a59e5daaafef3', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9e1fb03e2e4b21b43029f55680f762cb', 'bc917a1954e9352f1b8a59e5daaafef3', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('124f88760e2460dd432b1459c552c1c6', '30c621db1aa1a5e2c507248ad7f51611', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e9a2ba3bc31ded057efb9b4f455f468a', '30c621db1aa1a5e2c507248ad7f51611', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8585288bd332e4ee95e208f0071ca188', '30c621db1aa1a5e2c507248ad7f51611', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8b3a1b998c98b3cf216b0bc9fb479026', '30c621db1aa1a5e2c507248ad7f51611', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2699bb8f660b7a9d697399dd8fca0b7d', '7b1d6723f08255361df3d37621cda45e', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0624d2f5bb4e550b5db31881ad6d7d00', '7b1d6723f08255361df3d37621cda45e', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7ceccdf166ed92deca214417b916ec76', '7b1d6723f08255361df3d37621cda45e', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('24d30ca2a8142b829719411b8b760628', '7b1d6723f08255361df3d37621cda45e', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8e4767416c9926f5f488657e8caa1e22', '65cec7ad1a1a5acf39b3ecaa11f5fa12', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ca0f721695d980c0239d498395ea71e6', '65cec7ad1a1a5acf39b3ecaa11f5fa12', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d5ffda663c1a409a8e0dfc013c516976', '65cec7ad1a1a5acf39b3ecaa11f5fa12', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e588decc99b148e132d88b887189f6b0', '65cec7ad1a1a5acf39b3ecaa11f5fa12', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2ec7e9535e2709a75161b6eb306efb6a', '80ee78967dd88f2fd170dc91fb682adc', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ae22b2669e464da702f2b8346c5e6fea', '80ee78967dd88f2fd170dc91fb682adc', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4bb7bf09489e557fc9c179d25a88af29', '80ee78967dd88f2fd170dc91fb682adc', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11c04376dba29901c998b8d571592396', '80ee78967dd88f2fd170dc91fb682adc', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('27eec48f972d99f46ef5e7d44ac69ac4', '57cac8f843a1ecda644a24441e59f19d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7ba8087f12fdef149ab0c42245b4c112', '57cac8f843a1ecda644a24441e59f19d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('67c06024995c0579a7ef806627e8b774', '57cac8f843a1ecda644a24441e59f19d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('85c57a570e6067e0829951014476d849', '57cac8f843a1ecda644a24441e59f19d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6ddf3ee0fa99ab4a9fca599d09cae3db', 'ec5881cae07271e0efcd72595f599e84', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e2fd5ffb5435a17daee931c2c6b0eafe', 'ec5881cae07271e0efcd72595f599e84', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fe11b0c48fca6ef4444ffb97063afbad', 'ec5881cae07271e0efcd72595f599e84', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('76b6d4bb89eabd62f4c31c9b5705edba', 'ec5881cae07271e0efcd72595f599e84', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('35dd40f518eb24da5ca558bf640065c9', '0995b5858b7dd64b69c0631aa502ac33', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f5fff7d72abbca27a62a1f88b279fd2b', '0995b5858b7dd64b69c0631aa502ac33', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('55d7a173a704318e73e5c6592b7cdf42', '0995b5858b7dd64b69c0631aa502ac33', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7ad729a5d01f9d393f5a32019a8cac43', '0995b5858b7dd64b69c0631aa502ac33', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fcaa71df81fb38dcc9d2958fd031b480', '2eb0248fd603083dad8c66e1dfb21efb', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5c7b79c923da75776cdaf7f0934c33ab', '2eb0248fd603083dad8c66e1dfb21efb', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3cafe3e461ee90b0f33441330475c4f8', '2eb0248fd603083dad8c66e1dfb21efb', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('de13087a893bfbbf893c39142b3e8751', '2eb0248fd603083dad8c66e1dfb21efb', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7ce629163d0241fc2b86a3610845bdf7', '7cc5e1a461fd37ae677996ae7ea85fc0', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6165bbbf46495a5da0e6c08920f36aa1', '7cc5e1a461fd37ae677996ae7ea85fc0', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d6aa95367b15f34c7462404d272d74f1', '7cc5e1a461fd37ae677996ae7ea85fc0', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('564785dec59c81e9a4c7f9ad0d504f80', '7cc5e1a461fd37ae677996ae7ea85fc0', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bd26ff0b6df1172ec9c812243f82f3a2', '715cbf9c8be4e45d7c99c945813e8d9c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('77286e5306c38e94c966f1b0ff46a631', '715cbf9c8be4e45d7c99c945813e8d9c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('15c2ab2facd8fa692eeab0c4e9133716', '715cbf9c8be4e45d7c99c945813e8d9c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bd5a22f52ee4c74be4d1b88ce64ea203', '715cbf9c8be4e45d7c99c945813e8d9c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11e8076658a517ed21aef9571fe83c94', 'e45913261a7d590074e53e929ab661ec', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cc8531f27fcaa7c3d9082c66dea9fa16', 'e45913261a7d590074e53e929ab661ec', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cc38e9adfa13f3d9f9e2435db689a7a6', 'e45913261a7d590074e53e929ab661ec', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0901aaf1973d914085aaab4f180c3db6', 'e45913261a7d590074e53e929ab661ec', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4eb5811f7b9a263dd3b6b1d5bc9a837b', '141fb97c4ccb0abe9a52f432d1f65a94', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3c1db7afce884ecc0724474c57791f22', '141fb97c4ccb0abe9a52f432d1f65a94', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('96696ff9e5e37118c885d62e12509ce5', '141fb97c4ccb0abe9a52f432d1f65a94', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('08dd9cbf0b921040f23c56b65b7f4c7e', '141fb97c4ccb0abe9a52f432d1f65a94', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b624365d6c70d1b2e1d06342d8ed00a0', '2982a39137ef269dad9ba71a91c007c3', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1a7aa82e4b7fe2b128b7ec448eb93c6d', '2982a39137ef269dad9ba71a91c007c3', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b38ae50dba9de7fed5cf933011f38901', '2982a39137ef269dad9ba71a91c007c3', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e96dd8649eb787a76128e42986937180', '2982a39137ef269dad9ba71a91c007c3', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('731ef0c48d6b04fae188dd74ec78469e', '27b4e1a4bf860d5afabbdfc51ebc2f38', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e9d6d01659f8ffd711cd162e1059a471', '27b4e1a4bf860d5afabbdfc51ebc2f38', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('144afb433059030a57f42518fcec4980', '27b4e1a4bf860d5afabbdfc51ebc2f38', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('368093e8cad1237a37b158c9e9ce5e52', '27b4e1a4bf860d5afabbdfc51ebc2f38', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7c4958fd546819697aed6f9b044f3531', '67b9328f1fc29e22e7d380b9328a5a22', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5a165932bdfdf4d1b5ae4c81f7ee6b16', '67b9328f1fc29e22e7d380b9328a5a22', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5cf037ca6337a4b78b4d0eb8cba7063d', '67b9328f1fc29e22e7d380b9328a5a22', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0e8768d1319d7a79a509f66bf54b8abf', '67b9328f1fc29e22e7d380b9328a5a22', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('71754800f6d3c10523651f368481798a', '5a26415e5628839c4fc80154c759316a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8158f6490592ed6fbc6ddca82c574dc8', '5a26415e5628839c4fc80154c759316a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cc4f382679cfa5e2e71be3ca871b86b3', '5a26415e5628839c4fc80154c759316a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('964f5f9c0711d3de44e012e238210fae', '5a26415e5628839c4fc80154c759316a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6bfda2ca00fbc90f06dc44e2e486dae9', 'ce643ed453cc12f4151d898c0d1030f7', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('64269dba0b246941d5cf87d39a0d425e', 'ce643ed453cc12f4151d898c0d1030f7', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7fa9ae6a55757c1b36cbb09e2577513f', 'ce643ed453cc12f4151d898c0d1030f7', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c695e757ed08b6450043e8f2a094da92', 'ce643ed453cc12f4151d898c0d1030f7', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d718c0ade28c2f33b9e2e3830e0586d3', 'bd75179eb6f083c4a8f0c0ffdbf4de1a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('56ed423acf22d6117bfa2419606c0fc7', 'bd75179eb6f083c4a8f0c0ffdbf4de1a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('155a9141905097b22c5885cbfe30bef7', 'bd75179eb6f083c4a8f0c0ffdbf4de1a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('62631146f7d1a81204fa85c8e10cf267', 'bd75179eb6f083c4a8f0c0ffdbf4de1a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9d02ae740cf1f8aba1fab39e67f09c6a', 'b23e964f3cccefb3ab15f907c3e8d988', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cad1cfe592e3639e86d7e47f513d3eb8', 'b23e964f3cccefb3ab15f907c3e8d988', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2ada2e9f2f1cd2038ed25749bdf3d4cd', 'b23e964f3cccefb3ab15f907c3e8d988', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3a2b751cd9bcac5de1934d4bdf715bce', 'b23e964f3cccefb3ab15f907c3e8d988', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('77ce0ec1fe037ac1f0d59c53f46f313f', 'f44e14ba45823475703eae1f579f6b31', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('276eaa7c52946f808a21e343054e8575', 'f44e14ba45823475703eae1f579f6b31', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('438db70a9a265596a75a84b25103cf38', 'f44e14ba45823475703eae1f579f6b31', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7657213c118db18d4eb4787a2c6be574', 'f44e14ba45823475703eae1f579f6b31', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d0932687bb396cd525a944cdba9bb85e', 'cc6ce3f624fef2d84b3d4b01dfc3b4b2', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('98003f2b8a54f7f30029dcb7bcff7bc8', 'cc6ce3f624fef2d84b3d4b01dfc3b4b2', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0e23a06e90f570c47ca8ea4a91abde78', 'cc6ce3f624fef2d84b3d4b01dfc3b4b2', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('00e525274b27f617920664630f522e91', 'cc6ce3f624fef2d84b3d4b01dfc3b4b2', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c7868d1cd8fdbe3a9c7d0d507204d62e', '94cefd1cf9c0404300298c85393d491a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0811228d7e9ddc2fc4560a23aebf46cc', '94cefd1cf9c0404300298c85393d491a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6c4b3ce94fc8eccaff9d0c0fe52e8a9a', '94cefd1cf9c0404300298c85393d491a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5d0c9d5f4eb73a8e413bc1e186eb3477', '94cefd1cf9c0404300298c85393d491a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0e569e3034ae490484a04f8398ac4451', 'f051e332a973b1ea6cea9ce295b870dd', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('164dffa483c125e34859cdbeab43f1f4', 'f051e332a973b1ea6cea9ce295b870dd', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b3c46ed0fcd9f8dbacb2044ce2098ad4', 'f051e332a973b1ea6cea9ce295b870dd', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fc66adcc01bdaf4306e8969c60c2a30a', 'f051e332a973b1ea6cea9ce295b870dd', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3018a404b059d2ce9a7e7e22293fa8c0', '5e35d68e5abb8f4e2ef07330804b6aaa', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6af5a589a374b4fb105858eb1bf63c4f', '5e35d68e5abb8f4e2ef07330804b6aaa', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('66a6340836bc050c1af7b5ddeda028aa', '5e35d68e5abb8f4e2ef07330804b6aaa', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a51bcee1fab53beb16b76ef8f3f009bf', '5e35d68e5abb8f4e2ef07330804b6aaa', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5f27c55c66e052977d70e54cea6cc9df', 'cd52a19cd57902b123a4612e093d5372', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cd275868393299f7c747739dc8719eb1', 'cd52a19cd57902b123a4612e093d5372', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11b0322c3ff9e97b72781fc27c5c57d7', 'cd52a19cd57902b123a4612e093d5372', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e9b084e2a69367a727cdd65970a4e63e', 'cd52a19cd57902b123a4612e093d5372', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2b0df3b4d86a7d9c920b1b52992d3cea', '2963a0b9267fc0236701cda306353d10', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3a383781f0695bb37aa85fbc584ff74c', '2963a0b9267fc0236701cda306353d10', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0bda8c16360110d12e2060aa2ad6b0bf', '2963a0b9267fc0236701cda306353d10', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1cce3fcfba47be9d29397ca1a36ba8ff', '2963a0b9267fc0236701cda306353d10', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2b136c50bab8908ff9257190079457b8', '3f1b8e9368e133ec1ee5d7a557542b07', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f7e6d7e2665d8b1ae6516f3906c26a99', '3f1b8e9368e133ec1ee5d7a557542b07', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('260306166b9baf9407038162662f5a52', '3f1b8e9368e133ec1ee5d7a557542b07', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('93bf9e4d1167e9270ddd0ac02562c679', '3f1b8e9368e133ec1ee5d7a557542b07', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('392b0f0000252a381ec3f2abaf1dad60', '4fb925e1a770ef60d050c2b74b567aa1', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f2c7b4ce31d3bc3c54196c6acf3544ef', '4fb925e1a770ef60d050c2b74b567aa1', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d7a015cf14ff16306f06c0d8a28c64f2', '4fb925e1a770ef60d050c2b74b567aa1', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ff260c6fb1e30b79da8b388d5c7a20cd', '4fb925e1a770ef60d050c2b74b567aa1', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('51d85840cc17cbbf636acaf162e6ca8a', 'a243ab5f6b545b431c6256d7fac0fe5d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('26e4a283a866ad4988580ddcb036d55d', 'a243ab5f6b545b431c6256d7fac0fe5d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1e4148a96401658b5481aded4ce0af1b', 'a243ab5f6b545b431c6256d7fac0fe5d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('256ab96bfa013ad388c2010e164b44fb', 'a243ab5f6b545b431c6256d7fac0fe5d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a86020d0a935884ec4130d2326f433c2', '57c5c569836ea256e87de0f45192c08f', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8d8ec789fe438b363e8abc7be340f6e5', '57c5c569836ea256e87de0f45192c08f', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('29bb4713ae5ae8d58771bf02e8dd3ce4', '57c5c569836ea256e87de0f45192c08f', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6871937727b31f6da352796c04b7117d', '57c5c569836ea256e87de0f45192c08f', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0c1583d12a956b33b156b38c3aaa89cf', '9f54ef9ab2aac967e7b0466a766ae2a8', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('84f80931c39e257b0cf10b38ef3492ca', '9f54ef9ab2aac967e7b0466a766ae2a8', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8e9f7af3ac4424b40ce86f43de99fcff', '9f54ef9ab2aac967e7b0466a766ae2a8', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d657e056ad8d68eba64bd7889ec74ae8', '9f54ef9ab2aac967e7b0466a766ae2a8', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2255d99f6d89cdfcc66d78c8fd79e7bd', '3c93e20875dd2f3d982a4e04ef3fafde', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e49074afbf7f5570047e1c3e2e53a028', '3c93e20875dd2f3d982a4e04ef3fafde', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9285fd89fa2a2cc1640ecb63a5b8d6d5', '3c93e20875dd2f3d982a4e04ef3fafde', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9782593805cfb08845e524a55c8c3c77', '3c93e20875dd2f3d982a4e04ef3fafde', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2b96bb94eaf7e91927dd4be770905d04', '9c57633e776d23a3524282718b88cbc2', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('48d5856fac840a98746a5edce5cefbf8', '9c57633e776d23a3524282718b88cbc2', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d00e044298cfcf768afff11aaa37bab8', '9c57633e776d23a3524282718b88cbc2', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('328ef988a50378d144285932ca71af2f', '9c57633e776d23a3524282718b88cbc2', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ae2ded6a84f9d4483dee7ac866565c61', 'd5864ede137992b6ddbe39150159625f', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bb2d374829bee2cabb16c6e415580bf9', 'd5864ede137992b6ddbe39150159625f', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c18cc968769adfd7fb2814495342bc8f', 'd5864ede137992b6ddbe39150159625f', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('98ee92da782b36ce60c48d8c65c83c2c', 'd5864ede137992b6ddbe39150159625f', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5eb14a2c0a376dae7504354b82cdf06b', 'b7de2d9b3f024c83e650c08c4502a208', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1d5f50f2a18c9429e8445e4b6487d4f8', 'b7de2d9b3f024c83e650c08c4502a208', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('76e20df99b2029aa40de44a73eded0dd', 'b7de2d9b3f024c83e650c08c4502a208', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b8bfb994e6053ea845ad2404203d16c5', 'b7de2d9b3f024c83e650c08c4502a208', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('24de11b7dffeb010a8217180064b5b6b', 'b7409388beb58f5221d58e48e108aca1', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5f5f661fa045a1cea2b410418d4cb841', 'b7409388beb58f5221d58e48e108aca1', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b384261fb38cce8526aaaea4dae6d7c3', 'b7409388beb58f5221d58e48e108aca1', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e871edabec90e47af6cdc82eb287fdab', 'b7409388beb58f5221d58e48e108aca1', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8173541f8ab81a7b35495e9a484b9f70', 'eae82dd69bf6d8804502066171aac67e', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('35846d3c619d2753b52637a7edb36226', 'eae82dd69bf6d8804502066171aac67e', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('33389af72a73e7474633ba6161437650', 'eae82dd69bf6d8804502066171aac67e', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cd31f88a44f4db0fba9336b33512992a', 'eae82dd69bf6d8804502066171aac67e', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('23fff9a47e1f47151c71217eecf172af', '264676e918df895f9e1f21de02c09c11', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('65a05f9600a07c07e7054a919305c432', '264676e918df895f9e1f21de02c09c11', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('52cea3e88404cb254095a30b25c3730e', '264676e918df895f9e1f21de02c09c11', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3f94104e003d1007e168d403c7b62f98', '264676e918df895f9e1f21de02c09c11', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('87666143cf027037beb49c2fed33cbf9', '0b0eb8b62a2281af1bafcf6caec5c87f', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fb42c0a6ac7dddcb958118d38310e2bb', '0b0eb8b62a2281af1bafcf6caec5c87f', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fb77016a00cd51906de62863fd9649a3', '0b0eb8b62a2281af1bafcf6caec5c87f', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e69a50cd788abcc6287034f3332b5763', '0b0eb8b62a2281af1bafcf6caec5c87f', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b8ff8b3c32d225c3eba348751177fa16', '11645b5b71d771b4ffb36c27b38d7abc', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ce8abf4930c3b8396e24aaa655d6d9c7', '11645b5b71d771b4ffb36c27b38d7abc', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3cfc287a07eb88f859cc62b91d23e95a', '11645b5b71d771b4ffb36c27b38d7abc', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('755c48ad4aceeaf38e1716f9c811d575', '11645b5b71d771b4ffb36c27b38d7abc', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f4861b545f52cf13f820e79075fa54e1', '02a279094e8f7273fd9b154cb5262a2d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9da4f5dcae93cb29d57ecd7b17ff5e96', '02a279094e8f7273fd9b154cb5262a2d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e15e83f606778f767083a06b00a8137c', '02a279094e8f7273fd9b154cb5262a2d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('62d0f792d56833916358ff99abf44f07', '02a279094e8f7273fd9b154cb5262a2d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f5b0d1bbb900f5c6a246cc7e0ce1ee76', '85b5a1878b19fefebc2cb4919b4baafd', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7484ef23f80ed8a1ef237ade0307275e', '85b5a1878b19fefebc2cb4919b4baafd', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('51ddc228160b8fbc0875fe3aa99e37f9', '85b5a1878b19fefebc2cb4919b4baafd', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('717286d0b4052ea212411325a904c76c', '85b5a1878b19fefebc2cb4919b4baafd', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('27e4f842c81b1d1b4cec83d4f1a774fa', '44d627a229d5385d3f19e6173bf17c5b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b6d9db1fe4a1a3530512eef382d942ec', '44d627a229d5385d3f19e6173bf17c5b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('496f8e63498b46ef269bc935016db113', '44d627a229d5385d3f19e6173bf17c5b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bcd29cdad5f70b88cfc96f44367e1ab0', '44d627a229d5385d3f19e6173bf17c5b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0e9c6615473895ed4b1be84928fd3f88', 'ec3b4f03b2cc56aad4577a9013616d07', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9f30539c9c6f2453578abbde16156571', 'ec3b4f03b2cc56aad4577a9013616d07', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('227593b0d6907881ab0b9a7839bcbfbc', 'ec3b4f03b2cc56aad4577a9013616d07', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('509f8e0c215227cc323efe8ed9d21cf5', 'ec3b4f03b2cc56aad4577a9013616d07', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('546c81d2ca1a2bab9ea562209e092249', '7b9f3372167720ab8704dc2345eb9d8b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('78dc050f1b8fd042a789281a8855e457', '7b9f3372167720ab8704dc2345eb9d8b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b6ef5a5ec450dc77a6531dbce833b107', '7b9f3372167720ab8704dc2345eb9d8b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fa3f487525fffea1c240475abf5aa581', '7b9f3372167720ab8704dc2345eb9d8b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('119cbcaf617be69f0efb409771d10892', '26d3c6b44637634379aba1b888f348e9', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e0a3361f565a89bc74e514249b204f0e', '26d3c6b44637634379aba1b888f348e9', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1101c26d57e66748b9b60165d56615d8', '26d3c6b44637634379aba1b888f348e9', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7006db014f26abe82b490ced68131cb8', '26d3c6b44637634379aba1b888f348e9', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5b795b31f58bcd7a48c893e7f0063e29', 'a00eae9116c3530862354bc846bc8ea1', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e11c84cb8aab00d4c64732d9a87d196', 'a00eae9116c3530862354bc846bc8ea1', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f2af5680c954f4b2e98dfb9a54e23dfd', 'a00eae9116c3530862354bc846bc8ea1', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e6bf187ae6e180c8eb6a590a024cbcd', 'a00eae9116c3530862354bc846bc8ea1', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1748263a70032088cd5e9faac791485d', '00e79b49d657e0162bb2984ee7a2aecc', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('09589138e6eb8373ba44798dcf00e94a', '00e79b49d657e0162bb2984ee7a2aecc', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d2c5e885f8f9e489bb6f54efa844d46f', '00e79b49d657e0162bb2984ee7a2aecc', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f0025364858eb185796f1a663efc3278', '00e79b49d657e0162bb2984ee7a2aecc', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4e47a47a7997780a57bd8c1fd208076c', 'e5aca7b2419d389312a2c784d82f2125', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('732673cd03e02513dd0c7604f0ed75f0', 'e5aca7b2419d389312a2c784d82f2125', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3f32647c75b32b9e900702962a9fc54a', 'e5aca7b2419d389312a2c784d82f2125', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4e4c74d280870af7ac465ed5b7796b24', 'e5aca7b2419d389312a2c784d82f2125', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e2b52d54fd7c2f7e331e1d629ffaa088', '2f992cae7bd58ebbc297133043a3d85a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('190961506c593f6c7c1ef8738cbf3672', '2f992cae7bd58ebbc297133043a3d85a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('936429aafe28915fe6c207c5b1b5a968', '2f992cae7bd58ebbc297133043a3d85a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0bb410419ae84dc380ba7fc7b0cf98ad', '2f992cae7bd58ebbc297133043a3d85a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('98daf5ac8c7d91180143317438e64582', 'f690f5680829ac2a70bbf21fc114ed2e', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e50f9cb1babef98d0896b9903c1fc4c3', 'f690f5680829ac2a70bbf21fc114ed2e', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d26135a16c443bcb16afffb402820692', 'f690f5680829ac2a70bbf21fc114ed2e', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6775ec61436995a58fd69a56a5156488', 'f690f5680829ac2a70bbf21fc114ed2e', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cc2b91b4cbd2f42a14af7f1336a42321', '611967215d9765a43e550949c1e2a864', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9dbf16198ade5c4f97f79dd0fb0a3e29', '611967215d9765a43e550949c1e2a864', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e098b7f1c56c0ca606a947f4729a7399', '611967215d9765a43e550949c1e2a864', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c7a62b1ec694ec81d12499d89c20d2c3', '611967215d9765a43e550949c1e2a864', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a88848df4ba4255b4d3124298aeebb62', '39e03f771165a13a314efa92e7b222ca', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2820f5712d3b4475093692c521c47f57', '39e03f771165a13a314efa92e7b222ca', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5affa2c581b190f803926636435c4b6b', '39e03f771165a13a314efa92e7b222ca', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a1cc7744973f12671bc0c83f2e4cf821', '39e03f771165a13a314efa92e7b222ca', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ef95e8ded5db0ff75c152a30e3c05f17', 'd79b1f3a77d415dba4b566c4fbb84d1e', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('41896de9281eb29b7a9127f5e34a2fb0', 'd79b1f3a77d415dba4b566c4fbb84d1e', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d5cb14067a54d4fbc8cea6ef50b78c44', 'd79b1f3a77d415dba4b566c4fbb84d1e', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f01cf87efe103fc78939f4c47ff635c5', 'd79b1f3a77d415dba4b566c4fbb84d1e', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d0d8f3a322604271b73c0b22a13fb589', '65f4ff0e3ea3ecb8bfae2f90aedaa52b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f85bc273174c5afe293325afb47a8741', '65f4ff0e3ea3ecb8bfae2f90aedaa52b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('207c5e8ac157f8ff7d267d1f94b7a636', '65f4ff0e3ea3ecb8bfae2f90aedaa52b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4777247304be75bc4d3288c5825d69c1', '65f4ff0e3ea3ecb8bfae2f90aedaa52b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b9fd40f58ee1d00218c7c6eafe580b34', 'e01be61cdcd3a2d0086256df4a0622ae', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3903d4abd68d9a80e301b21151fa7ca9', 'e01be61cdcd3a2d0086256df4a0622ae', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9e7e11020dbd3c02ccb930fbff4eca9d', 'e01be61cdcd3a2d0086256df4a0622ae', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f94305b9fa38fb060390b02987686938', 'e01be61cdcd3a2d0086256df4a0622ae', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ecdd2839b7d438b2daa48ecc21e85ae2', 'cf84da90eadb602fe95ea016d6f6f600', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bdb205f06ca2254809ca9009bb10aeab', 'cf84da90eadb602fe95ea016d6f6f600', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('10cdbb30f2276be71805178bfa21b3e0', 'cf84da90eadb602fe95ea016d6f6f600', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c6ef01315c1afb2f6b1827944eb71556', 'cf84da90eadb602fe95ea016d6f6f600', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1020dd246f28595d75c1c619c7fcd671', '193cfa592d389dafd77a1571c7b7b668', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6323f25ad80ce17d7e7c84f4cb7b0b02', '193cfa592d389dafd77a1571c7b7b668', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('57ece50e4c718b5590c27016ef2670f6', '193cfa592d389dafd77a1571c7b7b668', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6afeb2e92754a279754cf1d82a4e9a62', '193cfa592d389dafd77a1571c7b7b668', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d79976af6af7d3d67c7faa7df9315cb5', '451e099aed1b33605b38e2589b8cd604', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('09cd61b71f7870c527df7f74a3901266', '451e099aed1b33605b38e2589b8cd604', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('eb62eccdb08553ae514005711cf0fbd4', '451e099aed1b33605b38e2589b8cd604', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('130a81754098cec5e228e30eb584263e', '451e099aed1b33605b38e2589b8cd604', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6711705ef6e0326b2203959288844f1d', 'b1d989603bc70b09d69e2bf134530f65', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('92c4df41e12940b245a1029970558370', 'b1d989603bc70b09d69e2bf134530f65', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c1b96f2b3243b244dfb325c07da60098', 'b1d989603bc70b09d69e2bf134530f65', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('39363dd4921290c30147339b4c66b86b', 'b1d989603bc70b09d69e2bf134530f65', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7e623de00ed522b7c2aa06c3cba39bfa', '5314a9da3c0d743f64a63a08179b452b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('be52859297c1e5840d208f2c6e5c5608', '5314a9da3c0d743f64a63a08179b452b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d55ea192ff0881738a7974f4a95381d7', '5314a9da3c0d743f64a63a08179b452b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('71a33af7a18fcf36b74d63e15f7f1f6c', '5314a9da3c0d743f64a63a08179b452b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f47853214254ed87b628013c0033780f', 'e4d1c7fb4b59df43673c3b3ede7e7062', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3f3e86a4017aa618194e5e9cae1e5091', 'e4d1c7fb4b59df43673c3b3ede7e7062', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c6f86777ddcaea87624f8eef0aa9e799', 'e4d1c7fb4b59df43673c3b3ede7e7062', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e56c91079146d9555f8c363e838052e7', 'e4d1c7fb4b59df43673c3b3ede7e7062', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5971e7aa5821d2ae1362afc608700ebf', '5516e6f99027268c411016c94e6f6200', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e3a1cfdcb4e14a0cdcd62310363ff52', '5516e6f99027268c411016c94e6f6200', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f9d498218eaacceca74f99f857e84718', '5516e6f99027268c411016c94e6f6200', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('36c418ba54f38b0cb04ced68c2326b16', '5516e6f99027268c411016c94e6f6200', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ad11fa44bc37f54b239f6436e3c9e3a5', '258dfa7063c2b38da365c94dcd8c1511', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f4ca4025b1326f726db9b5d74a342a12', '258dfa7063c2b38da365c94dcd8c1511', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f2f92845ecd52c0f02148a3dcb88f5d7', '258dfa7063c2b38da365c94dcd8c1511', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ea707e42b5226704fe124d1aec209e75', '258dfa7063c2b38da365c94dcd8c1511', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9e1890fa22b218dc12d1787076409388', '813d032cdff6404ec315252a3a410bd8', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e4afa81ac014a86c71b5b55798a35268', '813d032cdff6404ec315252a3a410bd8', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ed586879680383d9131eb50392f6d81a', '813d032cdff6404ec315252a3a410bd8', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e25a0c2d5d285b216f1538566937bab7', '813d032cdff6404ec315252a3a410bd8', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a0cacdd8c63b57fb96e7c0510b9799cd', '66b3d96d541cd9aa705aea9e130b7a18', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('21ecc33880874a4519a2e3b8cf51af36', '66b3d96d541cd9aa705aea9e130b7a18', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11afe078e9b074cda3abf667e9e4bb8e', '66b3d96d541cd9aa705aea9e130b7a18', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('860fe904223f6b8603de90452b773ab2', '66b3d96d541cd9aa705aea9e130b7a18', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a1e025bce76feb619dd46f50f42ea4f3', 'f96cd71823456444e5d1deb3e4fb8ed2', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6319a76767cf1690eeacf3028c41d4b1', 'f96cd71823456444e5d1deb3e4fb8ed2', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('44018ee2e730fa5fbcf276c94011639b', 'f96cd71823456444e5d1deb3e4fb8ed2', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b82aa7373894901b970caee73218988a', 'f96cd71823456444e5d1deb3e4fb8ed2', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('20f41d6d8a5addf19d999d92dbee1c91', '692c2be762e761f53d2a36605aa1b0c6', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('322487258c5066c997e50697594629ca', '692c2be762e761f53d2a36605aa1b0c6', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f9050d135a0d539ebb10ce29ecde81a7', '692c2be762e761f53d2a36605aa1b0c6', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('dbb4cee2ed8586a4ac3b1c945a3fc453', '692c2be762e761f53d2a36605aa1b0c6', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c1c55973c9e5d692caa32e003f890361', 'a7d95635067995135dc4e49efce17e64', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ad6c36955523c65e93b8ed5d07b1000b', 'a7d95635067995135dc4e49efce17e64', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ba37374c71c77c6a175583af3840ae77', 'a7d95635067995135dc4e49efce17e64', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ab73534cc2062cf7393531d799599c69', 'a7d95635067995135dc4e49efce17e64', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('878429c188cab23e06b75a68eec633e2', '0289d6268866fdf2d956eb834829a884', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e4aa548c9e4b941642f3389365a1fb3', '0289d6268866fdf2d956eb834829a884', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('74d5b04400d2d8b36d75650f86eb8201', '0289d6268866fdf2d956eb834829a884', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('85a0ac49b1f8f47b0479259c3e1a2308', '0289d6268866fdf2d956eb834829a884', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('068947d3bcb94e92e5a7dc4a406c2084', '388b59ec7cefb0f6f49595e464e50602', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('55910428a6011601b360c72ce7e57e12', '388b59ec7cefb0f6f49595e464e50602', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('28e30eca4b61b16ff858310959d3d22b', '388b59ec7cefb0f6f49595e464e50602', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('042295219a967076a4968b8fa1662d65', '388b59ec7cefb0f6f49595e464e50602', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('81f3d6ee60b3ead6dde085552b59889d', '0716aa3c40b16aad43279e092a84611c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('663729c4df139251cc5558d81e23a85d', '0716aa3c40b16aad43279e092a84611c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6d8d3c2c209c2dabdd2741a72289fbfd', '0716aa3c40b16aad43279e092a84611c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0466b3036a01bb6062915c85bf3b0da1', '0716aa3c40b16aad43279e092a84611c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b7ce3d0f0dd573af3e0b89f60f5d91b5', '3977813da4a892c17c18d69fcbcff2df', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0f0421f40a34263de87ea2ead169ecbb', '3977813da4a892c17c18d69fcbcff2df', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('49a99fd6042daaea2bced99e20106c44', '3977813da4a892c17c18d69fcbcff2df', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('36e36345a48a637920c20c8ac714f0ea', '3977813da4a892c17c18d69fcbcff2df', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('169741bac1ef414c2bf66f09fdf87491', 'fc0d20d9946564f9fee46c5381a28cb5', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('77eb4cd7b06f12e54cdd6ec37cb92da3', 'fc0d20d9946564f9fee46c5381a28cb5', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d1318e03eabefd6a58b9c1d68d32f5bd', 'fc0d20d9946564f9fee46c5381a28cb5', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3f24fd537e8dda261ff053fe1a5ccdb1', 'fc0d20d9946564f9fee46c5381a28cb5', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c1d28a00903f55c424f368afa6f1211b', 'b0bc358a7c9686d284c4d20aaabdd488', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8dbb64a2eb91767504892e31c36e65e1', 'b0bc358a7c9686d284c4d20aaabdd488', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a1793f8c16356e41c5429e7df7d4ac87', 'b0bc358a7c9686d284c4d20aaabdd488', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0f4581a03e39464c3a282edd99d23283', 'b0bc358a7c9686d284c4d20aaabdd488', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a942b985f769e98fba030fc283e18b11', 'd6da18043a12854fd753db32dee31abc', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('502c02cac27478d3dce87a6b8ed6fc23', 'd6da18043a12854fd753db32dee31abc', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7d2864337469a90c8c6d615bac9cbb19', 'd6da18043a12854fd753db32dee31abc', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ea6bd5e5f02e3c30310efb36bdb998e0', 'd6da18043a12854fd753db32dee31abc', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d018ab598b55f9c3ca93e7dffd586be5', '85b82933a14c350f7975846963262803', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1c72c4c8066a57e4bebb19ba7afa8560', '85b82933a14c350f7975846963262803', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a539311ea808bf68c5be1eaab582bd37', '85b82933a14c350f7975846963262803', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b6fd9257fbee93812642b7c5a97a7110', '85b82933a14c350f7975846963262803', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('bd14de2ea0461c515f069d4f3a6f6fe6', 'e2f4920ac512743010795f17d47a3f9f', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('961ceb0fd060d6edba35235047e97f96', 'e2f4920ac512743010795f17d47a3f9f', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1473a438cf5ac4f112cde18eecbf838a', 'e2f4920ac512743010795f17d47a3f9f', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('274666a030ac3147ebd690a7c0477622', 'e2f4920ac512743010795f17d47a3f9f', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e69ca498e9ffb89c82b704264a654ca0', 'c0a9bc85b38f344732925635b20102c8', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7c6cd597e8b0d5321a35de6b84216df0', 'c0a9bc85b38f344732925635b20102c8', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8ebe0f34c9fee1468b74ca0f0566d5c8', 'c0a9bc85b38f344732925635b20102c8', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b8f986c96a95ae46fcb27892bbe4e300', 'c0a9bc85b38f344732925635b20102c8', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('be258b746535e69c5e4d17d082ea4d39', '4bc8bb70234e6fdce3f2c0a16424a2c0', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9eadacc51a75b3ebd0016cb38b81e886', '4bc8bb70234e6fdce3f2c0a16424a2c0', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5c89434272582cf67e56c577861930f9', '4bc8bb70234e6fdce3f2c0a16424a2c0', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1837c57aef983c19dc740d5638d038c2', '4bc8bb70234e6fdce3f2c0a16424a2c0', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('563e1790d953050ef95827fa7cde7f86', 'd470e8e528000f4da2b163cde131527a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b1b3cae7b8e3e0956248cf89c975432e', 'd470e8e528000f4da2b163cde131527a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('26bc4f9f0c656719e7538c783e042e97', 'd470e8e528000f4da2b163cde131527a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('532f91e5acb51a5a6ff3d3827bb289a0', 'd470e8e528000f4da2b163cde131527a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('22a4843b882a5b8b3573331cb7de7f32', 'b4f60dae31aa2e7f28e19b6a8a9da10c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('86cb5f7c8f7aa72de967ae1563e98f37', 'b4f60dae31aa2e7f28e19b6a8a9da10c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ae6c28f60e10a146a2c049c110c20ba1', 'b4f60dae31aa2e7f28e19b6a8a9da10c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f288a738234b42437f83f8879efe1198', 'b4f60dae31aa2e7f28e19b6a8a9da10c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('81af9efe91ea619e9188dd53bbd2ec47', '7ddc41e04f341cc46bca20c7f55fa51c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('27e49b4f410ddfa12ea4abc2cdbf635a', '7ddc41e04f341cc46bca20c7f55fa51c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3e24c3b6c51053542fc0c99da6182d04', '7ddc41e04f341cc46bca20c7f55fa51c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4945b699fa1d647a46d88f4a1405947a', '7ddc41e04f341cc46bca20c7f55fa51c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('719e23b1fccd14d45b748600dd83fbb9', '3e903a386a50d5f812116265180d7c1e', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d3182d13c7506b0b6dee430bd824c946', '3e903a386a50d5f812116265180d7c1e', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('945c1e56b3ea96942a654b00af8ae28f', '3e903a386a50d5f812116265180d7c1e', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b492ef9232fd6ad5b7a37e377a0399ab', '3e903a386a50d5f812116265180d7c1e', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('18a60373a83e2a400414c420b5271a1e', 'baab81beca97aab6cce1c0c42d1f2254', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11749e6beae0423d3b6a882574929e13', 'baab81beca97aab6cce1c0c42d1f2254', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d8b95bafe42151b718e1f40b08024ecb', 'baab81beca97aab6cce1c0c42d1f2254', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b791ca9718e545e2019d47ad3a508226', 'baab81beca97aab6cce1c0c42d1f2254', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c1b95a875dfd0501a27580e8ff053659', '349a69bdec0fd9e725bafe8222117c6a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7f4beeccd313d9eee60844538ea8667b', '349a69bdec0fd9e725bafe8222117c6a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0faac86ef8ef3bdf2e257997a23f6648', '349a69bdec0fd9e725bafe8222117c6a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7c47a652a48d2a4d25dc2d45277e0887', '349a69bdec0fd9e725bafe8222117c6a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9816efb7ea32739db0a211d4d4512310', '6737df0219b6a89ec0a56ef5817866a7', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('dda3edec8dd137a6e2614ff3673b2ea0', '6737df0219b6a89ec0a56ef5817866a7', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('eafb713101cfda35d0a23d9b32550893', '6737df0219b6a89ec0a56ef5817866a7', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('748d4064a9654fc995fe0cb5a5a3af51', '6737df0219b6a89ec0a56ef5817866a7', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('50d46648040f6f8a858038415b82ced9', 'c865e179a99b78728e24b82a12a5ef46', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('76c73bd65b0faf1ce342069d6088c227', 'c865e179a99b78728e24b82a12a5ef46', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('76fafb5d4d756a3f9fdbd50338600b4a', 'c865e179a99b78728e24b82a12a5ef46', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('54598b0b02689d8f0103722ed0f7ad6a', 'c865e179a99b78728e24b82a12a5ef46', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c220bcfd04c13a063d80d6451b65563a', '708b6f371bd64c5b47a0987af3cdbe66', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('92e596186a4c4f30f2e0014229fb2f43', '708b6f371bd64c5b47a0987af3cdbe66', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9646133b85ac2437080272b2bfbb4f34', '708b6f371bd64c5b47a0987af3cdbe66', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('4e73243537d4f49dea65f70f8ef179e4', '708b6f371bd64c5b47a0987af3cdbe66', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c4841caf9378480816caff0a31ad0488', '62bcf817eaeb3121c463565fac63551f', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1b8cded1bcbe198121fb606f31af7705', '62bcf817eaeb3121c463565fac63551f', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d7602f8e00879189c01b7b278235bf80', '62bcf817eaeb3121c463565fac63551f', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('dab4a9d266cd7fa794d50866f286c338', '62bcf817eaeb3121c463565fac63551f', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cf812746e30be24fba6ef5aa04f92a31', '2333ddca761645954325eced511373f7', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ae01b652bf1a2dced4c099191c5ab827', '2333ddca761645954325eced511373f7', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8e6987c090eed300ae7d88823cb6b508', '2333ddca761645954325eced511373f7', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('52a61a0632cb951de99d47af59c9521c', '2333ddca761645954325eced511373f7', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('35e40599f80d1f3b721f67f3ccacd70f', 'f75c30cc43ef711451fd1c1839d5fac0', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('81a8876d77fe7e7ded290a8252c38331', 'f75c30cc43ef711451fd1c1839d5fac0', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('00212b39295cd3f96c7d98741254f952', 'f75c30cc43ef711451fd1c1839d5fac0', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('827442b0964d0ea194c2037a28d9d0ac', 'f75c30cc43ef711451fd1c1839d5fac0', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('81217af6adfd4427b39290d7dc5a0cc5', 'b06be3bda947d798cb61e80d93261213', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b6a4b23155c1007d76abdff0e8e2a690', 'b06be3bda947d798cb61e80d93261213', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d340380e6eb7fe1521065b3b00c1ad3a', 'b06be3bda947d798cb61e80d93261213', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7b3496ca5adcfa89312613052e9d02dd', 'b06be3bda947d798cb61e80d93261213', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a4d0d8da344f9bc34d177b8f3d1de8ca', '98bd758881d050d9c9c84328e2d3411b', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('947367dbcb366fa68bdf575ceda618ec', '98bd758881d050d9c9c84328e2d3411b', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('251ac2b2f16e6be5a523f3a718a9a75f', '98bd758881d050d9c9c84328e2d3411b', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2e2b1724f24f6b3a5e929f83b8ee10a9', '98bd758881d050d9c9c84328e2d3411b', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6bbca5c4448e01fd8fa1e0bece8fdd6a', '153c5c8c69508b8d1e6121d625aa45d6', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('95b2cff47d3a0c2640048595da512bd1', '153c5c8c69508b8d1e6121d625aa45d6', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5723a55a1f6419ed8a8cf9704f0fdb89', '153c5c8c69508b8d1e6121d625aa45d6', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('485e94669f0b830b0ef05177b2f33d80', '153c5c8c69508b8d1e6121d625aa45d6', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b70ec16bd8820189fc31155de48b5d13', '3ac74d4daa42001d49d3ee748b30e0e6', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a847765c6a247692e0891ea84dad1e41', '3ac74d4daa42001d49d3ee748b30e0e6', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('6445f53bad754e1e503076e9fc2ddcc0', '3ac74d4daa42001d49d3ee748b30e0e6', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('55213d6885b9596911c6cac8ab163692', '3ac74d4daa42001d49d3ee748b30e0e6', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c6354c850f23f35972a02fcd7c90df6e', 'c423dbe3d68a635c88b8e39829a9a621', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9d2a51f0b9c6f83a0b886337b965f5b5', 'c423dbe3d68a635c88b8e39829a9a621', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b5794b9d86a0db776de73289e5d9d9fd', 'c423dbe3d68a635c88b8e39829a9a621', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('01d6507f50a5d704dc74f7fb699163c4', 'c423dbe3d68a635c88b8e39829a9a621', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1039f738936837a40d699e346fef407b', '5d9d9432a157dff65cd1ca7c5f691bc8', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('429a0c595fdc76d7e395c3208703ed65', '5d9d9432a157dff65cd1ca7c5f691bc8', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1fe84d147d7adde636157bab7d242a30', '5d9d9432a157dff65cd1ca7c5f691bc8', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('619e985e71cd3ed5fcb922b237857897', '5d9d9432a157dff65cd1ca7c5f691bc8', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ce1c9fb4041b0ec18245e606509d9552', '409501db5f064aa75f3978247a2eeb29', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ebe68b0f49f27cf573dacab5f099be1c', '409501db5f064aa75f3978247a2eeb29', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('80b8221c5679e00c1940a218007292c3', '409501db5f064aa75f3978247a2eeb29', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('58f48c27d3148c0a45ba2ef9d94397cc', '409501db5f064aa75f3978247a2eeb29', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cfa87b07b14652826ca87a0ebccff140', 'ff74007b7c0157f6fc3fc18d33ff8774', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('396469a978630e3ce7848278409587f6', 'ff74007b7c0157f6fc3fc18d33ff8774', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3ebe6c11a77ff045eef4ec5a73f983f3', 'ff74007b7c0157f6fc3fc18d33ff8774', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3accaa2eafca93f79663fa3c899711c7', 'ff74007b7c0157f6fc3fc18d33ff8774', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('058624f367df8b3b65fdb10f986fa643', '04e5abe47ea3d86e339d92b7981b2a8d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('22339a467cf47bf40cc78f81e3d63a42', '04e5abe47ea3d86e339d92b7981b2a8d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3ffdc9de294c5cd8b9a60a76902fe695', '04e5abe47ea3d86e339d92b7981b2a8d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('47a231bbe6cdfd25d9754ec349e6fe58', '04e5abe47ea3d86e339d92b7981b2a8d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('39926771fe9b37fdadff5706a727b6a9', 'e5ce3cfd65222f5096b8c500248d943a', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9fa80688138e831688f34745185e6eff', 'e5ce3cfd65222f5096b8c500248d943a', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d17992cf2abd7fb138ef801a2bf060ac', 'e5ce3cfd65222f5096b8c500248d943a', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('40503d1e3480a4a09f8904b9bf002eac', 'e5ce3cfd65222f5096b8c500248d943a', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('80a3217ab16f22edcd52c0d2f7dac754', '2c3eaad44b4b78c48532e9ed786940dd', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('626f891e33cded78ad8c337debf5f7f6', '2c3eaad44b4b78c48532e9ed786940dd', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b23ddc608dbc8e23f013e173e5deea89', '2c3eaad44b4b78c48532e9ed786940dd', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cb51ccd46ce3885cf87e742daf6f3043', '2c3eaad44b4b78c48532e9ed786940dd', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('0cdc2070eb08028a9fa4eb4206a99942', '7d9bf0a55eb4496019b9e7c6dd75e19c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fb7528216e4e6a5d2acabfb5c5736b08', '7d9bf0a55eb4496019b9e7c6dd75e19c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('2a71a31dc3f02fa568d4b4a09ea488b1', '7d9bf0a55eb4496019b9e7c6dd75e19c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9ebb6ffaa2b1921ff00a0c9e35b3d99a', '7d9bf0a55eb4496019b9e7c6dd75e19c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('8ab0ffc51a770839167905e9ed51da16', '13a69c5ab23a19dbc630d73bb6cec6b8', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('46ecd8544ad9a7b7c21f2dd6add24092', '13a69c5ab23a19dbc630d73bb6cec6b8', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('3c3863059f88e4754965dbdb158c59a2', '13a69c5ab23a19dbc630d73bb6cec6b8', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f2751658e150bc69130e2e013214ad97', '13a69c5ab23a19dbc630d73bb6cec6b8', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('ffc49a5d7869753117fe61e8acec81a0', 'd92d0acec196aa4771db2501849e0b46', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('b85e62585e0abfaa98e4a990ba57cdb7', 'd92d0acec196aa4771db2501849e0b46', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c1977e83fe741098749cecf67561cc15', 'd92d0acec196aa4771db2501849e0b46', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('770765e9be399dc08aa94f5170850420', 'd92d0acec196aa4771db2501849e0b46', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('e7fd39691c4a780a6496a39fce6d9f10', 'c3cf3340fcd056cb8df14707319d1390', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('fcda706ca7de2d927abefcc6b1242162', 'c3cf3340fcd056cb8df14707319d1390', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('746068a482824a0b6d96e4120a091632', 'c3cf3340fcd056cb8df14707319d1390', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('90b67b06ebdb7c3f72ca40f278ce713a', 'c3cf3340fcd056cb8df14707319d1390', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('47017b891e1b1ec0191c2fc9631194e8', '2c5a643f90a665ade8916e6de133d2f4', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9b76055882272211113ab9577b4bcf68', '2c5a643f90a665ade8916e6de133d2f4', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('9b734100ac9764b360c9ca38f99146a5', '2c5a643f90a665ade8916e6de133d2f4', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7a39bbc3b874833538e711c4fb4cb22c', '2c5a643f90a665ade8916e6de133d2f4', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('5b6f21165b99eddcaf538aed20af2605', '4c209ac9202eb94c9fbd8f13ed259ea9', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('882e23527dd2996b396e4a5068778bb8', '4c209ac9202eb94c9fbd8f13ed259ea9', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('11d7464cc3d13b94734dd2f1c568aa64', '4c209ac9202eb94c9fbd8f13ed259ea9', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('83b8e156f9c880eaa2af52a4e933d8aa', '4c209ac9202eb94c9fbd8f13ed259ea9', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f63cd3078919e7133a20de983269edbb', 'c2d433a7bd7f1f70b3803efeff73864d', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('298de270abc0a986deccb07443bc39f7', 'c2d433a7bd7f1f70b3803efeff73864d', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('193b255fb88f36528cec1980f254d569', 'c2d433a7bd7f1f70b3803efeff73864d', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('846474bf557fd91aa61d4735bf099d6f', 'c2d433a7bd7f1f70b3803efeff73864d', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('7289da476bc05d41cd9a1c59ceb008ac', '598f41679cabca7cf908d93acc3d8a12', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cbd9bdfe6e9b5b8608871d1768265f80', '598f41679cabca7cf908d93acc3d8a12', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('d2914ae893be8be1a6972cdba3e0fa48', '598f41679cabca7cf908d93acc3d8a12', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('43f559572efb843df1a9f06b7ab9b0e5', '598f41679cabca7cf908d93acc3d8a12', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('dbb3b161fd13a9f6143cf8a685dcc38f', '6606d9cfb34bb1037fa7cb13ced60ef0', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('1e8ac2bc033e784237713ad19952b95e', '6606d9cfb34bb1037fa7cb13ced60ef0', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('43e117075f530259ceaa2c2be10d338d', '6606d9cfb34bb1037fa7cb13ced60ef0', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('c9b98511114e666a42b1bf58598b7ebd', '6606d9cfb34bb1037fa7cb13ced60ef0', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('965332afcd7acdea731712708afd3c01', 'e75126c64c62c4cc445dbed4997d7722', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('880d73d629613f182ecc5aceb945a777', 'e75126c64c62c4cc445dbed4997d7722', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('a0d9ee7fb41415ef9f2c535d0b7e9af2', 'e75126c64c62c4cc445dbed4997d7722', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('791cb7c9a39f03d69d25056f674c3e8d', 'e75126c64c62c4cc445dbed4997d7722', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('cfb5b32504945daebb7075f586b71910', 'e83b62abb5efbf9b4dc546c5cf4b569c', 'Polished', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('60b83038deedb5534749e342581bfabc', 'e83b62abb5efbf9b4dc546c5cf4b569c', 'Suede', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('41829ed5bf453ad657b47c3c2af99ece', 'e83b62abb5efbf9b4dc546c5cf4b569c', 'Matte', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;
INSERT INTO "product_colour_finish" ("id","colour_id","finish","updated_at") VALUES ('f4a7de97096ad12563ae97b6ecadcaa9', 'e83b62abb5efbf9b4dc546c5cf4b569c', 'Leathered', CURRENT_TIMESTAMP)
ON CONFLICT ("colour_id","finish") DO NOTHING;

COMMIT;


-- =====================================================================
-- CHECK IT LANDED — expect 7 / 129 / 516
-- =====================================================================
-- SELECT (SELECT count(*) FROM product_series)        AS series,
--        (SELECT count(*) FROM product_colour)        AS colours,
--        (SELECT count(*) FROM product_colour_finish) AS colour_finishes;

-- Every colour must have exactly four finishes. MUST return 0 rows.
-- SELECT c.name, count(f.id) AS finishes
-- FROM   product_colour c
-- LEFT   JOIN product_colour_finish f ON f.colour_id = c.id
-- GROUP  BY c.name HAVING count(f.id) <> 4;

-- Only the four words exist. MUST return 0 rows.
-- SELECT DISTINCT finish FROM product_colour_finish
-- WHERE  finish NOT IN ('Polished','Suede','Matte','Leathered');

-- The chart, as a person reads it:
-- SELECT s.name AS series, c.name AS colour,
--        string_agg(f.finish, ', ' ORDER BY f.finish) AS finishes
-- FROM   product_series s
-- JOIN   product_colour c ON c.series_id = s.id
-- JOIN   product_colour_finish f ON f.colour_id = c.id
-- GROUP  BY s.position, s.name, c.position, c.name
-- ORDER  BY s.position, c.position;
