/**
 * HSN Master Data Module
 *
 * Provides a curated static list of the most common HSN (Harmonized System of
 * Nomenclature) codes used by Indian SMBs, plus SAC (Services Accounting Codes)
 * under chapter 99.
 *
 * GST digit requirements by annual turnover:
 *   ≤ ₹5 Cr  : 4-digit HSN mandatory
 *   > ₹5 Cr  : 6-digit HSN mandatory
 *   (8-digit is optional but accepted at any turnover level)
 */

export interface HsnEntry {
  hsn: string;
  description: string;
  type: "goods" | "services";
}

// ── Master data ────────────────────────────────────────────────────────────────

const HSN_MASTER: HsnEntry[] = [
  // ── Chapter 01: Live animals ──────────────────────────────────
  { hsn: "0101", description: "Live horses, asses, mules and hinnies", type: "goods" },
  { hsn: "010121", description: "Live horses - pure-bred breeding animals", type: "goods" },
  { hsn: "010129", description: "Live horses - other", type: "goods" },
  { hsn: "0102", description: "Live bovine animals", type: "goods" },
  { hsn: "010221", description: "Live cattle - pure-bred breeding animals", type: "goods" },
  { hsn: "010229", description: "Live cattle - other", type: "goods" },
  { hsn: "0103", description: "Live swine", type: "goods" },
  { hsn: "0104", description: "Live sheep and goats", type: "goods" },
  { hsn: "0105", description: "Live poultry - fowls, ducks, geese, turkeys and guinea fowls", type: "goods" },

  // ── Chapter 02: Meat and edible offal ─────────────────────────
  { hsn: "0201", description: "Meat of bovine animals, fresh or chilled", type: "goods" },
  { hsn: "0202", description: "Meat of bovine animals, frozen", type: "goods" },
  { hsn: "0203", description: "Meat of swine, fresh, chilled or frozen", type: "goods" },
  { hsn: "0204", description: "Meat of sheep or goats, fresh, chilled or frozen", type: "goods" },
  { hsn: "0207", description: "Meat and edible offal of poultry, fresh, chilled or frozen", type: "goods" },
  { hsn: "0208", description: "Other meat and edible offal, fresh, chilled or frozen", type: "goods" },

  // ── Chapter 03: Fish, crustaceans, molluscs ───────────────────
  { hsn: "0301", description: "Live fish", type: "goods" },
  { hsn: "0302", description: "Fish, fresh or chilled, excluding fish fillets", type: "goods" },
  { hsn: "0303", description: "Fish, frozen, excluding fish fillets", type: "goods" },
  { hsn: "0304", description: "Fish fillets and other fish meat, fresh, chilled or frozen", type: "goods" },
  { hsn: "0306", description: "Crustaceans - lobsters, crabs, shrimps, prawns", type: "goods" },
  { hsn: "0307", description: "Molluscs - oysters, scallops, mussels, cuttlefish, squid", type: "goods" },

  // ── Chapter 04: Dairy, eggs, honey ────────────────────────────
  { hsn: "0401", description: "Milk and cream, not concentrated nor sweetened", type: "goods" },
  { hsn: "0402", description: "Milk and cream, concentrated or sweetened", type: "goods" },
  { hsn: "0403", description: "Buttermilk, curd, yogurt, kephir", type: "goods" },
  { hsn: "0404", description: "Whey and products consisting of natural milk components", type: "goods" },
  { hsn: "0405", description: "Butter and other fats and oils derived from milk; dairy spreads", type: "goods" },
  { hsn: "0406", description: "Cheese and curd", type: "goods" },
  { hsn: "0407", description: "Birds' eggs, in shell, fresh, preserved or cooked", type: "goods" },
  { hsn: "0409", description: "Natural honey", type: "goods" },

  // ── Chapter 06: Live trees, plants, bulbs ─────────────────────
  { hsn: "0601", description: "Bulbs, tubers, tuberous roots, corms, crowns and rhizomes, dormant", type: "goods" },
  { hsn: "0602", description: "Other live plants (including their roots), cuttings and slips; mushroom spawn", type: "goods" },
  { hsn: "0603", description: "Cut flowers and flower buds of a kind suitable for bouquets or for ornamental purposes", type: "goods" },
  { hsn: "0604", description: "Foliage, branches and other parts of plants, for bouquets or ornamental purposes", type: "goods" },

  // ── Chapter 07: Vegetables ────────────────────────────────────
  { hsn: "0701", description: "Potatoes, fresh or chilled", type: "goods" },
  { hsn: "0702", description: "Tomatoes, fresh or chilled", type: "goods" },
  { hsn: "0703", description: "Onions, shallots, garlic, leeks and other alliaceous vegetables", type: "goods" },
  { hsn: "0704", description: "Cabbages, cauliflowers, kohlrabi, kale and similar edible brassicas", type: "goods" },
  { hsn: "0705", description: "Lettuce and chicory, fresh or chilled", type: "goods" },
  { hsn: "0706", description: "Carrots, turnips, salad beetroot, radishes and similar edible roots", type: "goods" },
  { hsn: "0707", description: "Cucumbers and gherkins, fresh or chilled", type: "goods" },
  { hsn: "0708", description: "Leguminous vegetables, shelled or unshelled, fresh or chilled", type: "goods" },
  { hsn: "0709", description: "Other vegetables, fresh or chilled", type: "goods" },

  // ── Chapter 08: Fruit and nuts ────────────────────────────────
  { hsn: "0801", description: "Coconuts, Brazil nuts and cashew nuts, fresh or dried", type: "goods" },
  { hsn: "0802", description: "Other nuts - almonds, hazelnuts, walnuts, chestnuts, pistachios", type: "goods" },
  { hsn: "0803", description: "Bananas, including plantains, fresh or dried", type: "goods" },
  { hsn: "0804", description: "Dates, figs, pineapples, avocados, guavas, mangoes and mangosteens", type: "goods" },
  { hsn: "0805", description: "Citrus fruit - oranges, mandarins, lemons, limes, grapefruit", type: "goods" },
  { hsn: "0806", description: "Grapes, fresh or dried", type: "goods" },
  { hsn: "0807", description: "Melons (including watermelons) and papaws (papayas), fresh", type: "goods" },
  { hsn: "0808", description: "Apples, pears and quinces, fresh", type: "goods" },
  { hsn: "0809", description: "Apricots, cherries, peaches, plums and sloes, fresh", type: "goods" },

  // ── Chapter 10: Cereals ───────────────────────────────────────
  { hsn: "1001", description: "Wheat and meslin", type: "goods" },
  { hsn: "1002", description: "Rye", type: "goods" },
  { hsn: "1003", description: "Barley", type: "goods" },
  { hsn: "1004", description: "Oats", type: "goods" },
  { hsn: "1005", description: "Maize (corn)", type: "goods" },
  { hsn: "1006", description: "Rice", type: "goods" },
  { hsn: "100610", description: "Rice - rice in the husk (paddy or rough)", type: "goods" },
  { hsn: "100620", description: "Rice - husked (brown) rice", type: "goods" },
  { hsn: "100630", description: "Rice - semi-milled or wholly milled rice, whether or not polished or glazed", type: "goods" },
  { hsn: "1007", description: "Grain sorghum", type: "goods" },
  { hsn: "1008", description: "Buckwheat, millet and canary seed; other cereals", type: "goods" },

  // ── Chapter 11: Milling products ──────────────────────────────
  { hsn: "1101", description: "Wheat or meslin flour", type: "goods" },
  { hsn: "1102", description: "Cereal flours other than of wheat or meslin - maize, rye, rice flour", type: "goods" },
  { hsn: "1104", description: "Cereal grains otherwise worked (e.g. hulled, rolled, flaked, pearled)", type: "goods" },
  { hsn: "1107", description: "Malt, whether or not roasted", type: "goods" },

  // ── Chapter 12: Oil seeds ─────────────────────────────────────
  { hsn: "1201", description: "Soya beans, whether or not broken", type: "goods" },
  { hsn: "1202", description: "Groundnuts, not roasted or otherwise cooked", type: "goods" },
  { hsn: "1205", description: "Rape or colza seeds, whether or not broken", type: "goods" },
  { hsn: "1206", description: "Sunflower seeds, whether or not broken", type: "goods" },
  { hsn: "1207", description: "Other oil seeds and oleaginous fruits - mustard, sesame, linseed", type: "goods" },

  // ── Chapter 15: Fats and oils ─────────────────────────────────
  { hsn: "1501", description: "Pig fat (lard) and poultry fat", type: "goods" },
  { hsn: "1507", description: "Soya-bean oil and its fractions", type: "goods" },
  { hsn: "1508", description: "Groundnut oil and its fractions", type: "goods" },
  { hsn: "1509", description: "Olive oil and its fractions", type: "goods" },
  { hsn: "1511", description: "Palm oil and its fractions", type: "goods" },
  { hsn: "1512", description: "Sunflower-seed, safflower or cotton-seed oil and fractions", type: "goods" },
  { hsn: "1513", description: "Coconut (copra) oil, palm kernel or babassu oil and fractions", type: "goods" },
  { hsn: "1514", description: "Rapeseed, colza or mustard oil and fractions", type: "goods" },
  { hsn: "1516", description: "Animal or vegetable fats and oils and their fractions, hydrogenated", type: "goods" },
  { hsn: "1517", description: "Margarine; edible mixtures or preparations of animal or vegetable fats or oils", type: "goods" },

  // ── Chapter 17: Sugars ────────────────────────────────────────
  { hsn: "1701", description: "Cane or beet sugar and chemically pure sucrose, in solid form", type: "goods" },
  { hsn: "1702", description: "Other sugars - lactose, maltose, glucose and fructose", type: "goods" },
  { hsn: "1703", description: "Molasses resulting from the extraction or refining of sugar", type: "goods" },
  { hsn: "1704", description: "Sugar confectionery (including white chocolate), not containing cocoa", type: "goods" },

  // ── Chapter 18: Cocoa and preparations ───────────────────────
  { hsn: "1801", description: "Cocoa beans, whole or broken, raw or roasted", type: "goods" },
  { hsn: "1803", description: "Cocoa paste, whether or not defatted", type: "goods" },
  { hsn: "1804", description: "Cocoa butter, fat and oil", type: "goods" },
  { hsn: "1805", description: "Cocoa powder, not containing added sugar or sweetening matter", type: "goods" },
  { hsn: "1806", description: "Chocolate and other food preparations containing cocoa", type: "goods" },

  // ── Chapter 19: Preparations of cereals, flour ────────────────
  { hsn: "1901", description: "Malt extract; food preparations of flour, groats, starch or malt extract", type: "goods" },
  { hsn: "1902", description: "Pasta, whether or not cooked or stuffed (including macaroni, noodles, vermicelli)", type: "goods" },
  { hsn: "1904", description: "Prepared foods obtained by the swelling or roasting of cereals or cereal products", type: "goods" },
  { hsn: "1905", description: "Bread, pastry, cakes, biscuits and other bakers' wares, whether or not cocoa", type: "goods" },

  // ── Chapter 21: Miscellaneous edible preparations ─────────────
  { hsn: "2101", description: "Extracts, essences and concentrates of coffee, tea or mate", type: "goods" },
  { hsn: "2103", description: "Sauces and preparations therefor; mixed condiments and mixed seasonings; mustard flour", type: "goods" },
  { hsn: "2104", description: "Soups and broths and preparations therefor; homogenised composite food preparations", type: "goods" },
  { hsn: "2106", description: "Food preparations not elsewhere specified or included", type: "goods" },

  // ── Chapter 22: Beverages ─────────────────────────────────────
  { hsn: "2201", description: "Waters, including natural or artificial mineral waters and aerated waters", type: "goods" },
  { hsn: "2202", description: "Waters including mineral and aerated waters, containing added sugar or sweetening matter", type: "goods" },
  { hsn: "2203", description: "Beer made from malt", type: "goods" },
  { hsn: "2204", description: "Wine of fresh grapes, including fortified wines; grape must", type: "goods" },
  { hsn: "2207", description: "Undenatured ethyl alcohol of an alcoholic strength by volume of 80% vol or higher", type: "goods" },
  { hsn: "2208", description: "Undenatured ethyl alcohol of an alcoholic strength by volume of less than 80% vol; spirits, liqueurs", type: "goods" },

  // ── Chapter 24: Tobacco ───────────────────────────────────────
  { hsn: "2401", description: "Unmanufactured tobacco; tobacco refuse", type: "goods" },
  { hsn: "2402", description: "Cigars, cheroots, cigarillos and cigarettes, of tobacco or of tobacco substitutes", type: "goods" },
  { hsn: "2403", description: "Other manufactured tobacco and manufactured tobacco substitutes; homogenised or reconstituted tobacco", type: "goods" },

  // ── Chapter 25: Salt, sulphur, stone ─────────────────────────
  { hsn: "2501", description: "Salt (including table salt and denatured salt) and pure sodium chloride", type: "goods" },
  { hsn: "2502", description: "Unroasted iron pyrites", type: "goods" },
  { hsn: "2505", description: "Natural sands of all kinds, whether or not coloured", type: "goods" },
  { hsn: "2515", description: "Marble, travertine, ecaussine and other calcareous monumental or building stone", type: "goods" },
  { hsn: "2516", description: "Granite, porphyry, basalt, sandstone and other monumental or building stone", type: "goods" },
  { hsn: "2517", description: "Pebbles, gravel, broken or crushed stone; macadam; tar macadam; shingle and flint", type: "goods" },
  { hsn: "2523", description: "Portland cement, aluminous cement, slag cement, supersulphate cement and similar hydraulic cements", type: "goods" },

  // ── Chapter 27: Mineral fuels ─────────────────────────────────
  { hsn: "2701", description: "Coal; briquettes, ovoids and similar solid fuels manufactured from coal", type: "goods" },
  { hsn: "2709", description: "Petroleum oils and oils obtained from bituminous minerals, crude", type: "goods" },
  { hsn: "2710", description: "Petroleum oils and oils obtained from bituminous minerals, other than crude; preparations", type: "goods" },
  { hsn: "2711", description: "Petroleum gases and other gaseous hydrocarbons - LPG, natural gas", type: "goods" },
  { hsn: "2716", description: "Electrical energy", type: "goods" },

  // ── Chapter 28: Inorganic chemicals ──────────────────────────
  { hsn: "2801", description: "Fluorine, chlorine, bromine and iodine", type: "goods" },
  { hsn: "2804", description: "Hydrogen, rare gases and other non-metals", type: "goods" },
  { hsn: "2814", description: "Ammonia, anhydrous or in aqueous solution", type: "goods" },
  { hsn: "2835", description: "Phosphinates (hypophosphites), phosphonates (phosphites) and phosphates", type: "goods" },

  // ── Chapter 29: Organic chemicals ────────────────────────────
  { hsn: "2901", description: "Acyclic hydrocarbons", type: "goods" },
  { hsn: "2902", description: "Cyclic hydrocarbons", type: "goods" },
  { hsn: "2915", description: "Saturated acyclic monocarboxylic acids and their anhydrides", type: "goods" },

  // ── Chapter 30: Pharmaceutical products ──────────────────────
  { hsn: "3001", description: "Glands and other organs for organo-therapeutic uses, dried", type: "goods" },
  { hsn: "3002", description: "Human blood; animal blood prepared for therapeutic, prophylactic or diagnostic uses; vaccines", type: "goods" },
  { hsn: "3003", description: "Medicaments (excluding goods of heading 3002, 3005 or 3006) consisting of two or more constituents mixed together", type: "goods" },
  { hsn: "3004", description: "Medicaments consisting of mixed or unmixed products for therapeutic or prophylactic uses, put up in measured doses", type: "goods" },
  { hsn: "3005", description: "Wadding, gauze, bandages and similar articles (for example dressings, adhesive plasters, poultices)", type: "goods" },
  { hsn: "3006", description: "Pharmaceutical goods - sterile surgical catgut, dental cements, first-aid boxes", type: "goods" },

  // ── Chapter 31: Fertilisers ───────────────────────────────────
  { hsn: "3101", description: "Animal or vegetable fertilisers, whether or not mixed together or chemically treated", type: "goods" },
  { hsn: "3102", description: "Mineral or chemical fertilisers, nitrogenous - urea, ammonium nitrate", type: "goods" },
  { hsn: "3103", description: "Mineral or chemical fertilisers, phosphatic", type: "goods" },
  { hsn: "3104", description: "Mineral or chemical fertilisers, potassic", type: "goods" },
  { hsn: "3105", description: "Mineral or chemical fertilisers containing two or three of the fertilising elements NPK", type: "goods" },

  // ── Chapter 32: Tanning and dyeing extracts ───────────────────
  { hsn: "3204", description: "Synthetic organic colouring matter, whether or not chemically defined; preparations", type: "goods" },
  { hsn: "3208", description: "Paints and varnishes based on synthetic polymers or chemically modified natural polymers", type: "goods" },
  { hsn: "3209", description: "Paints and varnishes based on acrylic or vinyl polymers, in an aqueous medium", type: "goods" },
  { hsn: "3210", description: "Other paints and varnishes; prepared water pigments of a kind used for finishing leather", type: "goods" },
  { hsn: "3214", description: "Glaziers' putty, grafting putty, resin cements, caulking compounds and other mastics", type: "goods" },

  // ── Chapter 33: Essential oils and cosmetics ──────────────────
  { hsn: "3301", description: "Essential oils (terpeneless or not), including concretes and absolutes", type: "goods" },
  { hsn: "3303", description: "Perfumes and toilet waters", type: "goods" },
  { hsn: "3304", description: "Beauty or make-up preparations and preparations for the care of the skin", type: "goods" },
  { hsn: "3305", description: "Preparations for use on the hair - shampoos, hair conditioners, hair lacquers", type: "goods" },
  { hsn: "3306", description: "Preparations for oral or dental hygiene, including denture fixative pastes; dental floss", type: "goods" },
  { hsn: "3307", description: "Pre-shave, shaving or after-shave preparations; personal deodorants; bath preparations", type: "goods" },

  // ── Chapter 34: Soap, washing preparations ────────────────────
  { hsn: "3401", description: "Soap; organic surface-active products and preparations for use as soap", type: "goods" },
  { hsn: "3402", description: "Organic surface-active agents; surface-active preparations, washing preparations, cleaning preparations", type: "goods" },
  { hsn: "3406", description: "Candles, tapers and the like", type: "goods" },

  // ── Chapter 39: Plastics ──────────────────────────────────────
  { hsn: "3901", description: "Polymers of ethylene, in primary forms", type: "goods" },
  { hsn: "3902", description: "Polymers of propylene or of other olefins, in primary forms", type: "goods" },
  { hsn: "3903", description: "Polymers of styrene, in primary forms - polystyrene", type: "goods" },
  { hsn: "3904", description: "Polymers of vinyl chloride or of other halogenated olefins - PVC", type: "goods" },
  { hsn: "3907", description: "Polyacetals, other polyethers and epoxide resins, in primary forms; polycarbonate", type: "goods" },
  { hsn: "3919", description: "Self-adhesive plates, sheets, film, foil, tape, strip and other flat shapes, of plastics", type: "goods" },
  { hsn: "3920", description: "Other plates, sheets, film, foil and strip, of plastics, non-cellular and not reinforced", type: "goods" },
  { hsn: "3923", description: "Articles for the conveyance or packing of goods, of plastics - bags, containers, stoppers", type: "goods" },
  { hsn: "3924", description: "Tableware, kitchenware, other household articles and hygienic or toilet articles, of plastics", type: "goods" },
  { hsn: "3926", description: "Other articles of plastics and articles of other materials", type: "goods" },

  // ── Chapter 40: Rubber ────────────────────────────────────────
  { hsn: "4011", description: "New pneumatic tyres, of rubber", type: "goods" },
  { hsn: "4013", description: "Inner tubes, of rubber", type: "goods" },
  { hsn: "4016", description: "Other articles of vulcanised rubber other than hard rubber - gaskets, seals", type: "goods" },

  // ── Chapter 44: Wood and articles of wood ─────────────────────
  { hsn: "4401", description: "Fuel wood, in logs, in billets, in twigs, in faggots or in similar forms; wood chips or particles", type: "goods" },
  { hsn: "4403", description: "Wood in the rough, whether or not stripped of bark or sapwood", type: "goods" },
  { hsn: "4407", description: "Wood sawn or chipped lengthwise, sliced or peeled, whether or not planed, sanded or end-jointed", type: "goods" },
  { hsn: "4408", description: "Sheets for veneering (including those obtained by slicing laminated wood), for plywood", type: "goods" },
  { hsn: "4412", description: "Plywood, veneered panels and similar laminated wood", type: "goods" },
  { hsn: "4418", description: "Builders' joinery and carpentry of wood, including cellular wood panels, assembled flooring panels", type: "goods" },
  { hsn: "4419", description: "Tableware and kitchenware of wood", type: "goods" },

  // ── Chapter 48: Paper and paperboard ─────────────────────────
  { hsn: "4801", description: "Newsprint, in rolls or sheets", type: "goods" },
  { hsn: "4802", description: "Uncoated paper and paperboard, of a kind used for writing, printing or other graphic purposes", type: "goods" },
  { hsn: "4804", description: "Uncoated kraft paper and paperboard, in rolls or sheets", type: "goods" },
  { hsn: "4811", description: "Paper, paperboard, cellulose wadding and webs of cellulose fibres, coated, impregnated", type: "goods" },
  { hsn: "4818", description: "Toilet paper and similar paper, cellulose wadding or webs of cellulose fibres, of a kind used for household or sanitary purposes", type: "goods" },
  { hsn: "4819", description: "Cartons, boxes, cases, bags and other packing containers, of paper, paperboard, cellulose wadding", type: "goods" },
  { hsn: "4820", description: "Registers, account books, note books, order books, receipt books, letter pads, memorandum pads", type: "goods" },
  { hsn: "4821", description: "Paper or paperboard labels of all kinds, whether or not printed", type: "goods" },

  // ── Chapter 49: Printed books, newspapers ─────────────────────
  { hsn: "4901", description: "Printed books, brochures, leaflets and similar printed matter, whether or not in single sheets", type: "goods" },
  { hsn: "4902", description: "Newspapers, journals and periodicals, whether or not illustrated or containing advertising material", type: "goods" },
  { hsn: "4907", description: "Unused postage, revenue or similar stamps of current or new issue; cheque forms; banknotes; stock certificates", type: "goods" },
  { hsn: "4911", description: "Other printed matter, including printed pictures and photographs; calendars", type: "goods" },

  // ── Chapter 50-51: Silk, wool ─────────────────────────────────
  { hsn: "5007", description: "Woven fabrics of silk or of silk waste", type: "goods" },
  { hsn: "5105", description: "Wool and fine or coarse animal hair, carded or combed", type: "goods" },
  { hsn: "5112", description: "Woven fabrics of combed wool or of combed fine animal hair", type: "goods" },

  // ── Chapter 52: Cotton ────────────────────────────────────────
  { hsn: "5201", description: "Cotton, not carded or combed", type: "goods" },
  { hsn: "5205", description: "Cotton yarn (other than sewing thread), containing 85% or more by weight of cotton", type: "goods" },
  { hsn: "5208", description: "Woven fabrics of cotton, containing 85% or more by weight of cotton, weighing not more than 200 g/m2", type: "goods" },
  { hsn: "5209", description: "Woven fabrics of cotton, containing 85% or more by weight of cotton, weighing more than 200 g/m2", type: "goods" },

  // ── Chapter 54-55: Man-made fibres ────────────────────────────
  { hsn: "5402", description: "High tenacity yarn of nylon or other polyamides, of polyesters or of viscose rayon", type: "goods" },
  { hsn: "5407", description: "Woven fabrics of synthetic filament yarn, including woven fabrics obtained from materials of heading 5404", type: "goods" },
  { hsn: "5501", description: "Synthetic filament tow - nylon, polyester, acrylic tow", type: "goods" },
  { hsn: "5512", description: "Woven fabrics of synthetic staple fibres, containing 85% or more by weight of synthetic staple fibres", type: "goods" },

  // ── Chapter 58-60: Knitted fabrics and trimmings ──────────────
  { hsn: "5806", description: "Narrow woven fabrics, other than goods of heading 5807; narrow fabrics consisting of warp without weft", type: "goods" },
  { hsn: "5903", description: "Textile fabrics impregnated, coated, covered or laminated with plastics, other than those of heading 5902", type: "goods" },
  { hsn: "6001", description: "Pile fabrics, including 'long pile' fabrics and terry fabrics, knitted or crocheted", type: "goods" },

  // ── Chapter 61: Knitted or crocheted clothing ─────────────────
  { hsn: "6101", description: "Men's or boys' overcoats, car coats, capes, cloaks, anoraks, windcheaters, of knitted or crocheted fabric", type: "goods" },
  { hsn: "6104", description: "Women's or girls' suits, ensembles, jackets, blazers, dresses, skirts, trousers, knitted or crocheted", type: "goods" },
  { hsn: "6109", description: "T-shirts, singlets and other vests, knitted or crocheted", type: "goods" },
  { hsn: "6110", description: "Jerseys, pullovers, sweatshirts, waistcoats and similar articles, knitted or crocheted", type: "goods" },

  // ── Chapter 62: Not knitted or crocheted clothing ─────────────
  { hsn: "6201", description: "Men's or boys' overcoats, car coats, capes, cloaks, anoraks, wind-cheaters, not knitted", type: "goods" },
  { hsn: "6203", description: "Men's or boys' suits, ensembles, jackets, blazers, trousers, bib and brace overalls, not knitted", type: "goods" },
  { hsn: "6204", description: "Women's or girls' suits, ensembles, jackets, blazers, dresses, skirts, trousers, not knitted", type: "goods" },
  { hsn: "6206", description: "Women's or girls' blouses, shirts and shirt-blouses, not knitted or crocheted", type: "goods" },
  { hsn: "6211", description: "Track suits, ski suits and swimwear; other garments not elsewhere specified", type: "goods" },

  // ── Chapter 63: Textile articles ─────────────────────────────
  { hsn: "6301", description: "Blankets and travelling rugs", type: "goods" },
  { hsn: "6302", description: "Bed linen, table linen, toilet linen and kitchen linen", type: "goods" },
  { hsn: "6303", description: "Curtains (including drapes) and interior blinds; curtain or bed valances", type: "goods" },
  { hsn: "6304", description: "Other furnishing articles, excluding those of heading 9404 - bedspreads, cushion covers", type: "goods" },
  { hsn: "6305", description: "Sacks and bags, of a kind used for the packing of goods", type: "goods" },

  // ── Chapter 64: Footwear ──────────────────────────────────────
  { hsn: "6401", description: "Waterproof footwear with outer soles and uppers of rubber or of plastics", type: "goods" },
  { hsn: "6402", description: "Other footwear with outer soles and uppers of rubber or plastics - sports shoes, sandals", type: "goods" },
  { hsn: "6403", description: "Footwear with outer soles of rubber, plastics, leather or composition leather and uppers of leather", type: "goods" },
  { hsn: "6404", description: "Footwear with outer soles of rubber or plastics and uppers of textile materials - canvas shoes", type: "goods" },
  { hsn: "6405", description: "Other footwear", type: "goods" },

  // ── Chapter 65: Headgear ──────────────────────────────────────
  { hsn: "6501", description: "Hat-forms, hat bodies and hoods of felt, neither blocked to shape nor with made brims", type: "goods" },
  { hsn: "6505", description: "Hats and other headgear, knitted or crocheted, or made up from lace, felt or other textile fabric", type: "goods" },
  { hsn: "6506", description: "Other headgear, whether or not lined or trimmed - safety helmets, crash helmets", type: "goods" },

  // ── Chapter 68: Stone and cement products ─────────────────────
  { hsn: "6801", description: "Setts, curbstones and flagstones, of natural stone (except slate)", type: "goods" },
  { hsn: "6810", description: "Articles of cement, of concrete or of artificial stone, whether or not reinforced", type: "goods" },
  { hsn: "6811", description: "Articles of asbestos-cement, of cellulose fibre-cement or the like", type: "goods" },

  // ── Chapter 69: Ceramic products ─────────────────────────────
  { hsn: "6907", description: "Unglazed ceramic flags and paving, hearth or wall tiles; unglazed ceramic mosaic cubes and the like", type: "goods" },
  { hsn: "6908", description: "Glazed ceramic flags and paving, hearth or wall tiles; glazed ceramic mosaic cubes and the like", type: "goods" },
  { hsn: "6910", description: "Ceramic sinks, washbasins, washbasin pedestals, baths, bidets, water closet pans", type: "goods" },
  { hsn: "6911", description: "Tableware, kitchenware, other household articles and toilet articles, of porcelain or china", type: "goods" },

  // ── Chapter 70: Glass ─────────────────────────────────────────
  { hsn: "7003", description: "Cast glass and rolled glass, in sheets or profiles, whether or not having an absorbent, reflecting or non-reflecting layer", type: "goods" },
  { hsn: "7005", description: "Float glass and surface ground or polished glass, in sheets, whether or not having an absorbent, reflecting or non-reflecting layer", type: "goods" },
  { hsn: "7013", description: "Glassware of a kind used for table, kitchen, toilet, office, indoor decoration or similar purposes", type: "goods" },

  // ── Chapter 71: Jewellery and precious metals ─────────────────
  { hsn: "7101", description: "Pearls, natural or cultured, whether or not worked or graded", type: "goods" },
  { hsn: "7102", description: "Diamonds, whether or not worked, but not mounted or set", type: "goods" },
  { hsn: "7103", description: "Precious stones (other than diamonds) and semi-precious stones, whether or not worked", type: "goods" },
  { hsn: "7108", description: "Gold (including gold plated with platinum), unwrought or in semi-manufactured forms", type: "goods" },
  { hsn: "7113", description: "Articles of jewellery and parts thereof, of precious metal or of metal clad with precious metal", type: "goods" },
  { hsn: "7114", description: "Articles of goldsmiths' or silversmiths' wares and parts thereof, of precious metal", type: "goods" },

  // ── Chapter 72: Iron and steel ────────────────────────────────
  { hsn: "7201", description: "Pig iron and spiegeleisen in pigs, blocks or other primary forms", type: "goods" },
  { hsn: "7204", description: "Ferrous waste and scrap; remelting scrap ingots of iron or steel", type: "goods" },
  { hsn: "7207", description: "Semi-finished products of iron or non-alloy steel", type: "goods" },
  { hsn: "7208", description: "Flat-rolled products of iron or non-alloy steel, of a width of 600 mm or more, hot-rolled, not clad", type: "goods" },
  { hsn: "7210", description: "Flat-rolled products of iron or non-alloy steel, of a width of 600 mm or more, clad, plated or coated", type: "goods" },
  { hsn: "7213", description: "Bars and rods, hot-rolled, in irregularly wound coils, of iron or non-alloy steel", type: "goods" },
  { hsn: "7214", description: "Other bars and rods of iron or non-alloy steel, not further worked than forged, hot-rolled", type: "goods" },
  { hsn: "7216", description: "Angles, shapes and sections of iron or non-alloy steel", type: "goods" },
  { hsn: "7217", description: "Wire of iron or non-alloy steel", type: "goods" },
  { hsn: "7219", description: "Flat-rolled products of stainless steel, of a width of 600 mm or more", type: "goods" },
  { hsn: "7227", description: "Bars and rods, hot-rolled, in irregularly wound coils, of other alloy steel", type: "goods" },

  // ── Chapter 73: Steel articles ────────────────────────────────
  { hsn: "7301", description: "Sheet piling of iron or steel, whether or not drilled, punched or made from assembled elements", type: "goods" },
  { hsn: "7304", description: "Tubes, pipes and hollow profiles, seamless, of iron (other than cast iron) or steel", type: "goods" },
  { hsn: "7306", description: "Other tubes, pipes and hollow profiles (for example, open seam or welded, riveted or similarly closed), of iron or steel", type: "goods" },
  { hsn: "7308", description: "Structures and parts of structures, of iron or steel - bridges, towers, roofing, columns", type: "goods" },
  { hsn: "7312", description: "Stranded wire, ropes, cables, plaited bands, slings and the like, of iron or steel", type: "goods" },
  { hsn: "7315", description: "Chain and parts thereof, of iron or steel", type: "goods" },
  { hsn: "7318", description: "Screws, bolts, nuts, coach screws, screw hooks, rivets, cotters, cotter pins, washers of iron or steel", type: "goods" },

  // ── Chapter 74-76: Copper, nickel, aluminium ──────────────────
  { hsn: "7401", description: "Copper mattes; cement copper (precipitated copper)", type: "goods" },
  { hsn: "7403", description: "Refined copper and copper alloys, unwrought", type: "goods" },
  { hsn: "7408", description: "Copper wire", type: "goods" },
  { hsn: "7601", description: "Unwrought aluminium", type: "goods" },
  { hsn: "7604", description: "Aluminium bars, rods and profiles", type: "goods" },
  { hsn: "7607", description: "Aluminium foil (whether or not printed or backed with paper, paperboard, plastics or similar backing materials)", type: "goods" },
  { hsn: "7610", description: "Aluminium structures and parts of structures; aluminium plates, rods, profiles, tubes", type: "goods" },

  // ── Chapter 84: Machinery ─────────────────────────────────────
  { hsn: "8401", description: "Nuclear reactors; fuel elements (cartridges), non-irradiated, for nuclear reactors", type: "goods" },
  { hsn: "8408", description: "Compression-ignition internal combustion piston engines (diesel or semi-diesel engines)", type: "goods" },
  { hsn: "8409", description: "Parts suitable for use solely or principally with the engines of heading 8407 or 8408", type: "goods" },
  { hsn: "8411", description: "Turbojets, turbopropellers and other gas turbines", type: "goods" },
  { hsn: "8413", description: "Pumps for liquids, whether or not fitted with a measuring device", type: "goods" },
  { hsn: "8414", description: "Air or vacuum pumps, air or other gas compressors and fans; ventilating or recycling hoods", type: "goods" },
  { hsn: "8415", description: "Air conditioning machines, comprising a motor-driven fan and elements for changing the temperature and humidity", type: "goods" },
  { hsn: "8418", description: "Refrigerators, freezers and other refrigerating or freezing equipment, heat pumps", type: "goods" },
  { hsn: "8419", description: "Machinery, plant or laboratory equipment for treating materials by a process involving a change of temperature", type: "goods" },
  { hsn: "8422", description: "Dishwashing machines; machinery for cleaning or drying bottles or other containers; filling, closing, sealing machines", type: "goods" },
  { hsn: "8424", description: "Mechanical appliances (whether or not hand-operated) for projecting, dispersing or spraying liquids or powders", type: "goods" },
  { hsn: "8428", description: "Other lifting, handling, loading or unloading machinery - conveyors, escalators, cranes", type: "goods" },
  { hsn: "8429", description: "Self-propelled bulldozers, angledozers, graders, levellers, scrapers, mechanical shovels, excavators", type: "goods" },
  { hsn: "8430", description: "Other moving, grading, levelling, scraping, excavating, tamping, compacting, extracting or boring machinery", type: "goods" },
  { hsn: "8431", description: "Parts suitable for use solely or principally with the machinery of headings 8425 to 8430", type: "goods" },
  { hsn: "8443", description: "Printing machinery used for printing by means of the printing type, blocks, plates, cylinders and other printing components", type: "goods" },
  { hsn: "8450", description: "Household or laundry-type washing machines, including machines which both wash and dry", type: "goods" },
  { hsn: "8451", description: "Machinery for washing, cleaning, wringing, drying, ironing, pressing, bleaching, dyeing of yarn, fabrics", type: "goods" },
  { hsn: "8452", description: "Sewing machines, other than book-sewing machines of heading 8440", type: "goods" },
  { hsn: "8471", description: "Automatic data processing machines and units thereof; magnetic or optical readers, computers, laptops", type: "goods" },
  { hsn: "8473", description: "Parts and accessories suitable for use solely or principally with machines of heading 8469 to 8472", type: "goods" },
  { hsn: "8479", description: "Machines and mechanical appliances having individual functions, not specified or included elsewhere", type: "goods" },
  { hsn: "8481", description: "Taps, cocks, valves and similar appliances for pipes, boiler shells, tanks, vats or the like", type: "goods" },
  { hsn: "8483", description: "Transmission shafts and cranks; bearing housings and plain shaft bearings; gears and gearing; ball or roller screws", type: "goods" },
  { hsn: "8484", description: "Gaskets and similar joints of metal sheeting combined with other material or of two or more layers of metal", type: "goods" },

  // ── Chapter 85: Electrical equipment ─────────────────────────
  { hsn: "8501", description: "Electric motors and generators (excluding generating sets)", type: "goods" },
  { hsn: "8502", description: "Electric generating sets and rotary converters", type: "goods" },
  { hsn: "8503", description: "Parts suitable for use solely or principally with machines of heading 8501 or 8502", type: "goods" },
  { hsn: "8504", description: "Electrical transformers, static converters (for example, rectifiers) and inductors", type: "goods" },
  { hsn: "8507", description: "Electric accumulators, including separators therefor, whether or not rectangular - batteries", type: "goods" },
  { hsn: "8516", description: "Electric instantaneous or storage water heaters and immersion heaters; electric soil heating apparatus", type: "goods" },
  { hsn: "8517", description: "Telephone sets, including telephones for cellular networks or for other wireless networks; smartphones", type: "goods" },
  { hsn: "8518", description: "Microphones and stands therefor; loudspeakers, headphones, earphones, audio-frequency electric amplifiers", type: "goods" },
  { hsn: "8523", description: "Discs, tapes, solid-state non-volatile storage devices, smart cards and other media for recording", type: "goods" },
  { hsn: "8525", description: "Transmission apparatus for radio-broadcasting or television; television cameras, digital cameras, video camera recorders", type: "goods" },
  { hsn: "8528", description: "Monitors and projectors, not incorporating television reception apparatus; reception apparatus for television", type: "goods" },
  { hsn: "8529", description: "Parts suitable for use solely or principally with the apparatus of headings 8525 to 8528", type: "goods" },
  { hsn: "8534", description: "Printed circuits", type: "goods" },
  { hsn: "8536", description: "Electrical apparatus for switching or protecting electrical circuits - fuses, switches, sockets", type: "goods" },
  { hsn: "8537", description: "Boards, panels, consoles, desks, cabinets and other bases for electrical control or distribution", type: "goods" },
  { hsn: "8541", description: "Semiconductor devices; light-emitting diodes; mounted piezo-electric crystals", type: "goods" },
  { hsn: "8542", description: "Electronic integrated circuits", type: "goods" },
  { hsn: "8544", description: "Insulated wire, cable (including coaxial cable) and other insulated electric conductors", type: "goods" },

  // ── Chapter 87: Vehicles ──────────────────────────────────────
  { hsn: "8701", description: "Tractors (other than tractors of heading 8709)", type: "goods" },
  { hsn: "8702", description: "Motor vehicles for the transport of ten or more persons, including the driver - buses", type: "goods" },
  { hsn: "8703", description: "Motor cars and other motor vehicles principally designed for the transport of persons - cars, SUVs", type: "goods" },
  { hsn: "8704", description: "Motor vehicles for the transport of goods - trucks, lorries, pickup trucks", type: "goods" },
  { hsn: "8705", description: "Special purpose motor vehicles - cranes, fire fighting vehicles, concrete-mixer lorries", type: "goods" },
  { hsn: "8706", description: "Chassis fitted with engines, for the motor vehicles of headings 8701 to 8705", type: "goods" },
  { hsn: "8708", description: "Parts and accessories of the motor vehicles of headings 8701 to 8705 - bumpers, gearboxes, brakes", type: "goods" },
  { hsn: "8711", description: "Motorcycles (including mopeds) and cycles fitted with an auxiliary motor, with or without sidecars", type: "goods" },
  { hsn: "8712", description: "Bicycles and other cycles (including delivery tricycles), not motorised", type: "goods" },
  { hsn: "8714", description: "Parts and accessories of vehicles of headings 8711 to 8713", type: "goods" },

  // ── Chapter 90: Optical and measuring instruments ─────────────
  { hsn: "9003", description: "Frames and mountings for spectacles, goggles or the like, and parts thereof", type: "goods" },
  { hsn: "9004", description: "Spectacles, goggles and the like, corrective, protective or other", type: "goods" },
  { hsn: "9006", description: "Photographic (other than cinematographic) cameras; photographic flashlight apparatus", type: "goods" },
  { hsn: "9013", description: "Liquid crystal devices; lasers, other than laser diodes; other optical appliances and instruments", type: "goods" },
  { hsn: "9015", description: "Surveying (including photogrammetrical surveying), hydrographic, oceanographic, hydrological, meteorological instruments", type: "goods" },
  { hsn: "9018", description: "Instruments and appliances used in medical, surgical, dental or veterinary sciences - syringes, needles, catheters", type: "goods" },
  { hsn: "9021", description: "Orthopaedic appliances; splints and other fracture appliances; artificial parts of the body; hearing aids", type: "goods" },
  { hsn: "9025", description: "Hydrometers and similar floating instruments, thermometers, pyrometers, barometers, hygrometers and psychrometers", type: "goods" },
  { hsn: "9026", description: "Instruments and apparatus for measuring or checking the flow, level, pressure or other variables of liquids or gases", type: "goods" },
  { hsn: "9027", description: "Instruments and apparatus for physical or chemical analysis - gas or smoke analysis apparatus", type: "goods" },

  // ── Chapter 94: Furniture ─────────────────────────────────────
  { hsn: "9401", description: "Seats (other than those of heading 9402), whether or not convertible into beds - chairs, sofas", type: "goods" },
  { hsn: "9402", description: "Medical, surgical, dental or veterinary furniture - operating tables, hospital beds", type: "goods" },
  { hsn: "9403", description: "Other furniture and parts thereof - desks, shelves, cupboards, wardrobes", type: "goods" },
  { hsn: "9404", description: "Mattress supports; articles of bedding and similar furnishing - mattresses, quilts, pillows", type: "goods" },
  { hsn: "9405", description: "Luminaires and lighting fittings including searchlights and spotlights and parts thereof - lamps, chandeliers, LEDs", type: "goods" },

  // ── Chapter 95: Toys, games and sports requisites ─────────────
  { hsn: "9503", description: "Tricycles, scooters, pedal cars and similar wheeled toys; dolls' carriages; dolls; other toys; puzzles", type: "goods" },
  { hsn: "9504", description: "Video game consoles and machines, articles for funfair, table or parlour games", type: "goods" },
  { hsn: "9506", description: "Articles and equipment for general physical exercise, gymnastics, athletics, other sports - gym equipment", type: "goods" },
  { hsn: "9507", description: "Fishing rods, fish-hooks and other line fishing tackle; fish landing nets, butterfly nets", type: "goods" },

  // ── Chapter 96: Miscellaneous manufactured articles ───────────
  { hsn: "9601", description: "Worked ivory, bone, tortoise-shell, horn, antlers, coral, mother-of-pearl and other animal carving material", type: "goods" },
  { hsn: "9603", description: "Brooms, brushes (including brushes constituting parts of machines), hand-operated mechanical floor sweepers", type: "goods" },
  { hsn: "9604", description: "Hand sieves and hand riddles", type: "goods" },
  { hsn: "9606", description: "Buttons, press-fasteners, snap-fasteners and press-studs, button moulds and other parts", type: "goods" },
  { hsn: "9607", description: "Slide fasteners and parts thereof - zippers", type: "goods" },
  { hsn: "9608", description: "Ball point pens; felt tipped and other porous-tipped pens and markers; fountain pens; stylographs", type: "goods" },
  { hsn: "9609", description: "Pencils (other than pencils of heading 9608), crayons, pencil leads, pastels, drawing charcoals", type: "goods" },
  { hsn: "9613", description: "Cigarette lighters and other lighters, whether or not mechanical or electrical, and parts thereof", type: "goods" },
  { hsn: "9615", description: "Combs, hair-slides and the like; hairpins, curling pins, curling grips, hair curlers and the like", type: "goods" },
  { hsn: "9619", description: "Sanitary towels (pads) and tampons, napkins and napkin liners for babies and similar articles", type: "goods" },

  // ── Chapter 99: Services (SAC codes) ──────────────────────────
  { hsn: "9954", description: "Construction services - building, civil engineering, installation services", type: "services" },
  { hsn: "995411", description: "Construction services of single dwelling or multi-dwelling or multi-storied residential buildings", type: "services" },
  { hsn: "995412", description: "Construction services of other residential buildings such as old age homes, homeless shelters, hostels", type: "services" },
  { hsn: "995413", description: "Construction services of industrial buildings such as factories, warehouses, assembly lines", type: "services" },
  { hsn: "995414", description: "Construction services of commercial buildings such as office buildings, exhibition halls, malls", type: "services" },
  { hsn: "995415", description: "Construction services of other non-residential buildings such as educational, religious, social buildings", type: "services" },
  { hsn: "995416", description: "Construction services involving repair, alterations, additions, replacements, renovation, maintenance of buildings", type: "services" },
  { hsn: "9961", description: "Financial and related services - banking, credit, investment, insurance services", type: "services" },
  { hsn: "996111", description: "Central banking services", type: "services" },
  { hsn: "996112", description: "Deposit services", type: "services" },
  { hsn: "996113", description: "Credit granting services including stand-by commitment, guarantees and securities", type: "services" },
  { hsn: "996114", description: "Financial leasing services", type: "services" },
  { hsn: "996115", description: "Hire purchase services", type: "services" },
  { hsn: "9962", description: "Insurance and pension services", type: "services" },
  { hsn: "9963", description: "Real estate services", type: "services" },
  { hsn: "996311", description: "Rental or leasing services involving own or leased non-residential property", type: "services" },
  { hsn: "996312", description: "Rental or leasing services involving own or leased residential property", type: "services" },
  { hsn: "996313", description: "Trade services of buildings", type: "services" },
  { hsn: "996314", description: "Trade services of time-share properties", type: "services" },
  { hsn: "996321", description: "Property management services on a fee or contract basis for residential properties", type: "services" },
  { hsn: "996322", description: "Property management services on a fee or contract basis for non-residential properties", type: "services" },
  { hsn: "9964", description: "Rental and leasing services", type: "services" },
  { hsn: "996411", description: "Rental services of automobiles, trucks, trailers and semi-trailers without operator", type: "services" },
  { hsn: "996412", description: "Rental services of two-wheelers, bicycles without operator", type: "services" },
  { hsn: "996413", description: "Rental services of other transport vehicles without operator", type: "services" },
  { hsn: "996414", description: "Rental services of containers including tanks and boxes for liquids and gases", type: "services" },
  { hsn: "9971", description: "Information technology and related services", type: "services" },
  { hsn: "997111", description: "IT design and development services for software applications", type: "services" },
  { hsn: "997112", description: "IT design and development services for network and systems software", type: "services" },
  { hsn: "997113", description: "IT infrastructure and network management services", type: "services" },
  { hsn: "997114", description: "IT support and management services for hardware", type: "services" },
  { hsn: "997115", description: "IT infrastructure provisioning services - cloud computing, hosting services", type: "services" },
  { hsn: "997116", description: "IT technical support services", type: "services" },
  { hsn: "997117", description: "Other IT services not elsewhere classified", type: "services" },
  { hsn: "9972", description: "Telecommunications and broadcasting services", type: "services" },
  { hsn: "997211", description: "Fixed-line telephone services", type: "services" },
  { hsn: "997212", description: "Mobile telecommunications services", type: "services" },
  { hsn: "997213", description: "Internet telecommunications services", type: "services" },
  { hsn: "997214", description: "Private network services", type: "services" },
  { hsn: "997221", description: "Broadcasting and programme distribution services", type: "services" },
  { hsn: "9973", description: "Supply of manpower or staffing services", type: "services" },
  { hsn: "997311", description: "Provision of temporary staffing services", type: "services" },
  { hsn: "997312", description: "Provision of contract staffing services", type: "services" },
  { hsn: "997313", description: "Co-sourcing services", type: "services" },
  { hsn: "997314", description: "Payroll services", type: "services" },
  { hsn: "9981", description: "Government services not elsewhere classified", type: "services" },
  { hsn: "9982", description: "Education services", type: "services" },
  { hsn: "998211", description: "Primary education services", type: "services" },
  { hsn: "998212", description: "Secondary education services", type: "services" },
  { hsn: "998213", description: "Higher education services", type: "services" },
  { hsn: "998214", description: "Specialised education services", type: "services" },
  { hsn: "998221", description: "Tutoring and coaching services", type: "services" },
  { hsn: "9983", description: "Healthcare and social work services", type: "services" },
  { hsn: "998311", description: "Inpatient services", type: "services" },
  { hsn: "998312", description: "Medical and dental services", type: "services" },
  { hsn: "998313", description: "Childbirth and related services", type: "services" },
  { hsn: "9985", description: "Travel, tour operator and related services", type: "services" },
  { hsn: "998551", description: "Tour operator services", type: "services" },
  { hsn: "998552", description: "Tourist assistance services", type: "services" },
  { hsn: "9986", description: "Transportation and logistics services", type: "services" },
  { hsn: "996411", description: "Transportation of goods by road", type: "services" },
  { hsn: "998632", description: "Rental services of aircraft including helicopters without operator", type: "services" },
  { hsn: "9987", description: "Postal and courier services", type: "services" },
  { hsn: "998711", description: "Domestic postal services", type: "services" },
  { hsn: "998712", description: "Domestic express mail services", type: "services" },
  { hsn: "998713", description: "Domestic courier services", type: "services" },
  { hsn: "998714", description: "International postal services", type: "services" },
  { hsn: "998715", description: "International courier services", type: "services" },
  { hsn: "9988", description: "Manufacturing services on physical inputs owned by others - job work", type: "services" },
  { hsn: "998811", description: "Services by way of job work in relation to all food and food products", type: "services" },
  { hsn: "998812", description: "Services by way of job work in relation to manufacture of textiles and textile products", type: "services" },
  { hsn: "998813", description: "Services by way of job work in relation to manufacture of leather goods and footwear", type: "services" },
  { hsn: "998814", description: "Services by way of job work in relation to manufacture of paper and related products", type: "services" },
  { hsn: "998815", description: "Services by way of job work in relation to printing", type: "services" },
  { hsn: "998816", description: "Services by way of job work in relation to manufacture of plastic and rubber products", type: "services" },
  { hsn: "998817", description: "Services by way of job work in relation to manufacture of chemical products", type: "services" },
  { hsn: "998818", description: "Services by way of job work in relation to manufacture of machinery and equipment", type: "services" },
  { hsn: "9991", description: "Public administration and other government services", type: "services" },
  { hsn: "9992", description: "Membership organisation services", type: "services" },
  { hsn: "9993", description: "Human health and social care services", type: "services" },
  { hsn: "9994", description: "Sewage and waste collection, treatment and disposal and other environmental protection services", type: "services" },
  { hsn: "9995", description: "Services of membership organisations", type: "services" },
  { hsn: "9996", description: "Recreational, cultural and sporting services", type: "services" },
  { hsn: "999631", description: "Performing arts services", type: "services" },
  { hsn: "999632", description: "Support services to performing arts", type: "services" },
  { hsn: "999633", description: "Services provided by artistic creators", type: "services" },
  { hsn: "999641", description: "Sports and recreation services", type: "services" },
  { hsn: "999642", description: "Sports event promotion and organisation services", type: "services" },
  { hsn: "9997", description: "Other services not elsewhere classified", type: "services" },
  { hsn: "999711", description: "Laundry and dry-cleaning services", type: "services" },
  { hsn: "999712", description: "Hairdressing and barbers' shop services", type: "services" },
  { hsn: "999713", description: "Beautician services including nail care services, facial treatment", type: "services" },
  { hsn: "999714", description: "Massage and related services", type: "services" },
  { hsn: "999715", description: "Fitness centre services", type: "services" },
  { hsn: "999716", description: "Yoga instruction services", type: "services" },
];

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SearchOptions {
  type?: "goods" | "services";
  limit?: number;
}

/**
 * Search the HSN master data.
 *
 * - If the query is all digits, match codes that start with the query string.
 * - If the query contains non-digit characters, do a case-insensitive
 *   substring match on the description.
 *
 * Results are ordered by relevance:
 *   1. Exact code match
 *   2. Code starts with query
 *   3. Description contains the query
 *
 * The default limit is 20.
 */
export function searchHsn(query: string, opts?: SearchOptions): HsnEntry[] {
  const limit = opts?.limit ?? 20;
  const typeFilter = opts?.type;

  const trimmed = query.trim();
  if (!trimmed) return [];

  const isDigitQuery = /^\d+$/.test(trimmed);
  const lowerQuery = trimmed.toLowerCase();

  const scored: Array<{ entry: HsnEntry; score: number }> = [];

  for (const entry of HSN_MASTER) {
    if (typeFilter && entry.type !== typeFilter) continue;

    let score = 0;

    if (isDigitQuery) {
      if (entry.hsn === trimmed) {
        score = 3;
      } else if (entry.hsn.startsWith(trimmed)) {
        score = 2;
      }
    } else {
      if (entry.description.toLowerCase().includes(lowerQuery)) {
        score = 1;
      }
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // Sort by score descending, then by HSN code ascending for stable ordering
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.hsn.localeCompare(b.entry.hsn);
  });

  return scored.slice(0, limit).map(s => s.entry);
}

/**
 * Check whether a given code exists in the master data (as an exact match
 * or as the prefix of a longer code in the master list).
 *
 * Rules:
 *   - Must be at least 4 digits long
 *   - Must be entirely numeric
 *   - Must exist as an exact match in the master list
 */
export function isValidHsn(code: string): boolean {
  if (code.length < 4) return false;
  if (!/^\d+$/.test(code)) return false;
  return HSN_MASTER.some(entry => entry.hsn === code);
}

/**
 * Validate that an HSN code meets the digit-length requirement for the given
 * annual turnover, per CBIC/GST Council guidelines:
 *
 *   Annual turnover ≤ ₹5 Cr  → 4-digit minimum
 *   Annual turnover > ₹5 Cr  → 6-digit minimum
 *
 * @param hsn             - The HSN/SAC code to validate (string, may be 4–8 digits)
 * @param annualTurnover  - Annual turnover as a numeric string in rupees
 */
export function validateHsnForTurnover(
  hsn: string,
  annualTurnover: string
): { valid: boolean; message?: string } {
  const FIVE_CRORE = 50_000_000; // ₹5,00,00,000

  const turnover = parseFloat(annualTurnover);
  const digits = hsn.replace(/\D/g, "").length;

  if (turnover > FIVE_CRORE) {
    if (digits < 6) {
      return {
        valid: false,
        message: `Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has ${digits} digits.`,
      };
    }
  } else {
    if (digits < 4) {
      return {
        valid: false,
        message: `A minimum 4-digit HSN code is required. Provided code has ${digits} digits.`,
      };
    }
  }

  return { valid: true };
}
