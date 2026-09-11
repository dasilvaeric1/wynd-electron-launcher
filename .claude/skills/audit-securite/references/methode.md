# Méthode de qualification et de chiffrage

## Règles de qualification

Retenir uniquement les constats dont l'impact sur la confidentialité,
l'intégrité ou la disponibilité est démontrable par un chemin de code identifié.

Exclure du corps du rapport, et mentionner en annexe seulement si pertinent :

- les constats situés uniquement dans la documentation ou les fichiers Markdown ;
- l'absence isolée de journalisation d'audit ;
- les fuites de ressources sans impact de sécurité prouvé ;
- le déni de service non trivial ou nécessitant une authentification ;
- le tabnabbing, les XS-Leaks, la pollution de prototype et la redirection
  ouverte sans confiance très élevée et impact démontré ;
- l'absence de validation de champs non critiques sans conséquence établie ;
- la XSS dans React, Vue ou Angular sans contournement explicite de l'échappement.

Appliquer et documenter ces hypothèses de confiance :

- les variables d'environnement et arguments CLI sont de confiance ;
- les UUID sont non devinables ;
- la journalisation d'URL est sans risque, mais celle de secrets en clair est
  une vulnérabilité.

Mieux vaut un rapport court et fiable qu'exhaustif et bruité. Chaque constat
porte un niveau de confiance explicite. En dessous de `Moyenne`, le déclasser
en observation.

## Échelle de sévérité

| Niveau | CVSS v4 | Critère métier |
|---|---|---|
| Critique | 9,0-10,0 | Compromission totale, fuite massive, RCE non authentifiée |
| Élevée | 7,0-8,9 | Accès inter-utilisateurs, contournement d'authentification, élévation de privilèges |
| Moyenne | 4,0-6,9 | Prérequis nécessaire et impact circonscrit |
| Faible | 0,1-3,9 | Défaut de durcissement, impact indirect ou théorique |
| Observation | - | Bonne pratique sans vulnérabilité constituée |

En cas d'écart, la priorité suit l'impact métier et l'écart est justifié en une
phrase.

## Décomposition obligatoire

Chiffrer chaque constat en jours-homme, arrondis au 0,5, sur cinq postes :

| Poste | Contenu |
|---|---|
| Analyse | Périmètre d'impact et occurrences similaires |
| Développement | Correctif |
| Tests | Non-régression et preuve de sécurité |
| Revue | Relecture par un pair et validation sécurité |
| Déploiement | Migration, feature flag, coordination et communication |

## Barème de base

| Classe | Total | Profil type |
|---|---|---|
| XS | 0,5 j.h | Correction locale, une occurrence, sans migration |
| S | 1-2 j.h | Correction localisée et tests simples |
| M | 3-5 j.h | Plusieurs modules et tests à écrire |
| L | 6-12 j.h | Refonte, migration, rotation ou coordination |
| XL | >12 j.h | Architecture ou modèle de sécurité ; découper en lots |

## Facteurs de majoration

Appliquer multiplicativement les facteurs pertinents, avec un cumul plafonné à
2,5. Mentionner chaque facteur retenu.

| Facteur | Coefficient | Condition |
|---|---|---|
| Absence de tests sur la zone | x1,4 | Aucune couverture existante |
| Rupture de contrat d'API | x1,5 | Changement visible des consommateurs externes |
| Migration de données | x1,6 | Réécriture de données nécessaire |
| Rotation de secrets | x1,3 | Secret exposé à révoquer et redistribuer |
| Dépendance majeure | x1,5 | Montée majeure avec ruptures |
| Code non documenté ou legacy | x1,3 | Aucun propriétaire, faible lisibilité |
| Contrainte de conformité | x1,2 | Preuve ou validation formelle exigée |

## Incertitude

- `Haute` : périmètre délimité, marge de plus ou moins 20 %.
- `Moyenne` : périmètre probable, marge de plus ou moins 40 %.
- `Basse` : investigation préalable ; chiffrer un spike de 0,5 à 1 j.h à la
  place de l'estimation et l'indiquer explicitement.

## Charges transverses

Ajouter hors somme des constats :

- pilotage et suivi : 10 % du total des constats ;
- contre-audit : 15 % du total, minimum 1 j.h ;
- documentation de sécurité : 0,5 j.h.

Pour chaque constat, chiffrer les cinq postes par pas de 0,5 j.h et les sommer
dans le sous-total. Multiplier ce sous-total par les facteurs applicables, dont
le produit est plafonné à 2,5, puis arrondir le résultat au multiple de 0,5 le
plus proche. Déterminer la classe sur ce total majoré ; tout total supérieur à
12 j.h doit être découpé en lots plutôt que conservé en bloc XL.

La section 4 et le tableau `constats` du JSON contiennent uniquement les
vulnérabilités `SEC-*` confirmées de la section 5. Les éléments `OBS-*` restent
en section 6 : leur nombre est affiché dans la ligne `Observation` de la
section 1, mais leur charge est informative, non additive, et n'entre ni dans
`Total constats` ni dans les charges transverses.

La section 7 est une vue non additive. Lorsqu'une dépendance correspond à un
constat ou à une observation, préfixer son nom par l'ID associé dans la cellule
`Dépendance` et recopier sa charge sans l'ajouter une seconde fois aux totaux.

Calculer pilotage et contre-audit sur le total majoré des seuls constats
`SEC-*`, puis arrondir chacun au multiple de 0,5 le plus proche ; appliquer le
minimum de 1 j.h au contre-audit après arrondi. Calculer le budget sur le total
général affiché.

## Contrôles avant remise

1. Toutes les sections 1 à 11 sont présentes et dans l'ordre imposé.
2. Chaque constat possède un ID séquentiel, une localisation vérifiée, un CWE
   et un chiffrage décomposé.
3. Les protections en amont ont été recherchées pour chaque constat.
4. Aucun constat de confiance inférieure à moyenne ne figure en section 5.
5. Aucun constat exclu par les règles de qualification ne figure en section 5.
6. Les sommes individuelles et les charges transverses sont exactes.
7. Le tableau de bord et les détails sont cohérents.
8. Le JSON de la section 11 est valide et cohérent.
9. Aucun secret réel n'est reproduit ; quatre caractères de préfixe au maximum.
10. Aucune charge utile ni commande d'attaque exécutable n'apparaît.
11. Aucun fichier préexistant n'a été modifié ; seuls le nouveau rapport dans
  le dépôt central d'audits et ses répertoires de destination sont autorisés.
