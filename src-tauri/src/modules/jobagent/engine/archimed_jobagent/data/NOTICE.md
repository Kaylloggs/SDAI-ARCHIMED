# Données géographiques embarquées

| Fichier | Source | Licence |
|---|---|---|
| `cities.tsv` | [GeoNames](https://www.geonames.org/) — `cities15000`, réduit aux villes de plus de 40 000 habitants (nom normalisé, pays, coordonnées) | CC BY 4.0 |
| `countries.tsv` | [Natural Earth](https://www.naturalearthdata.com/) — points d'étiquette des pays | Domaine public |
| `../../../../../src/modules/jobagent/data/world.json` | Natural Earth 1:110m — contours extérieurs simplifiés, arrondis au dixième de degré | Domaine public |

Ces fichiers servent à placer les annonces sur la carte, hors ligne : aucun service de
géocodage n'est appelé.
