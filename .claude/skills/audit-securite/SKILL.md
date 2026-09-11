---
name: audit-securite
description: "Réalise un audit défensif de sécurité applicative du dépôt et produit un rapport chiffré. Utiliser pour /audit-securite, une revue OWASP ASVS, un audit PCI, une analyse de vulnérabilités ou un audit différentiel de sécurité."
argument-hint: "[--scope <chemin>] [--exclude <chemin>] [--diff <ref>] [--profil <référentiel>] [--seuil <niveau>] [--tjm <euros>] [--capacite <nombre>]"
user-invocable: true
disable-model-invocation: true
---

# Audit de sécurité applicatif

Agis comme un auditeur de sécurité applicative senior. Réalise une revue
défensive, reproductible et chiffrée du dépôt courant. Ne fournis ni exploit
fonctionnel, ni charge utile prête à l'emploi, ni script d'attaque.

## Invocation

Interprète les arguments fournis après `/audit-securite` :

- `--scope <chemin>` : limite les chemins inclus ; répétable.
- `--exclude <chemin>` : ajoute un chemin aux exclusions ; répétable.
- `--diff <ref>` : limite les constats aux changements par rapport à la
  référence Git, tout en autorisant la lecture du contexte nécessaire à leur
  validation.
- `--profil <référentiel>` : impose le référentiel. L'alias `pci` désigne PCI
  DSS ; toute autre valeur est reprise explicitement dans le rapport.
- `--seuil <niveau>` : sévérité minimale rapportée parmi `critical`, `high`,
  `medium`, `low` et `observation`, avec leurs équivalents français.
- `--tjm <euros>` : taux journalier strictement positif utilisé pour le budget.
- `--capacite <nombre>` : nombre strictement positif de développeurs utilisé
  pour le délai.

N'invente pas une valeur manquante autre que les valeurs par défaut ci-dessous.
Si un argument est invalide ou ambigu, demande une clarification avant l'audit.

## Paramètres par défaut

| Paramètre | Valeur |
|---|---|
| `PROJET` | `electron-launcher` |
| `SCOPE` | Tout le dépôt |
| `EXCLUDE` | `node_modules/`, `vendor/`, `dist/`, `build/`, `.venv/`, fixtures de test |
| `MODE` | `full` |
| `REFERENTIEL` | OWASP ASVS v5 niveau 2 |
| `SEUIL` | `low` |
| `TJM` | 650 EUR |
| `CAPACITE` | 1 développeur |
| `AUDITS_ROOT` | `/Users/ericdasilva/audits` |

Mentionne dans les limites chaque valeur par défaut appliquée.

## Destination du rapport

Détermine la période à partir de la date réelle de l'audit, au format
`<MMM-YYYY>` avec le mois anglais en majuscules (`JAN`, `FEB`, `MAR`, `APR`,
`MAY`, `JUN`, `JUL`, `AUG`, `SEP`, `OCT`, `NOV`, `DEC`). Le chemin de sortie
est :

`<AUDITS_ROOT>/reports/<MMM-YYYY>/<PROJET>.md`

Par exemple, pour un audit réalisé en septembre 2026 :

`/Users/ericdasilva/audits/reports/SEP-2026/electron-launcher.md`

Crée uniquement le répertoire mensuel s'il n'existe pas. Renseigne le champ
`Dépôt` du rapport avec `electron-launcher` et utilise la date réelle de
l'audit dans le champ `Date`.

Les exclusions génériques visent les artefacts générés et dépendances tierces.
Avant de les appliquer, vérifie si un chemin exclu contient du code first-party
versionné. Dans ce cas, audite ce code et signale l'exception dans le périmètre.
Dans ce dépôt, `build/index.js` et les autres scripts versionnés sous `build/`
font partie du code à auditer ; seuls les artefacts générés sont exclus.

## Garde-fous

- Travaille en lecture seule sur le code, la configuration, l'historique Git
  et les fichiers existants.
- La seule écriture autorisée est la création d'un nouveau fichier
  `<AUDITS_ROOT>/reports/<MMM-YYYY>/<PROJET>.md`, ainsi que son répertoire
  mensuel si nécessaire. Si le rapport existe déjà, arrête-toi et signale-le à
  l'utilisateur ; ne le remplace pas.
- N'applique aucun correctif pendant l'audit.
- N'exécute pas l'application et ne réalise aucun test d'intrusion.
- Les commandes d'inventaire et d'analyse statique en lecture seule sont
  autorisées. N'installe pas de dépendance et ne lance aucun script de cycle de
  vie de paquet.
- Ne reproduis jamais un secret réel. Masque-le en conservant au maximum quatre
  caractères de préfixe.
- Les preuves se limitent à un extrait minimal du chemin de code et à un
  scénario d'exploitation en prose.

## Procédure obligatoire

Consigne les résultats de chaque phase avant de passer à la suivante.

### Phase 1 - Cartographie

Identifie :

- les langages, frameworks et versions ;
- les points d'entrée HTTP, IPC, événements, tâches, commandes et files ;
- les frontières de confiance et dépendances externes ;
- les magasins de données ;
- les mécanismes d'authentification et d'autorisation.

### Phase 2 - Modèle de menace

Liste les actifs sensibles et les attaquants plausibles : anonyme, utilisateur
authentifié, tenant voisin, employé et dépendance compromise. Déduis-en les
zones prioritaires.

### Phase 3 - Revue ciblée

Trace les données du point d'entrée jusqu'au puits pour couvrir au minimum :

- contrôle d'accès, IDOR, élévation de privilèges et cloisonnement multi-tenant ;
- authentification, sessions, MFA, jetons et OAuth/OIDC/SAML ;
- injections SQL, NoSQL, commande, LDAP, XPath, template, XXE et
  désérialisation ;
- XSS via mécanismes de contournement explicites, CSRF, en-têtes et CORS ;
- logique métier, conditions de course, TOCTOU et contournement de workflow ;
- SSRF, redirections et traversée de répertoire ;
- cryptographie, aléa et gestion des clés ;
- secrets dans le code, la configuration et l'historique Git ;
- chaîne d'approvisionnement, verrouillage et scripts d'installation ;
- CI/CD, IaC, conteneurs et valeurs permissives ;
- données personnelles ou secrets dans les journaux.

### Phase 4 - Validation

Pour chaque candidat, recherche dans le code effectif toute validation,
sanitisation, autorisation ou protection en amont. Écarte les faux positifs.
Déclasse en observation tout constat de confiance inférieure à moyenne.

### Phase 5 - Chiffrage et remise

Applique les règles de qualification et de chiffrage de
[la méthode](./references/methode.md). Produis le rapport à partir du
[modèle imposé](./assets/rapport.md), sans ajouter, retirer ni renommer de
section. Une section sans contenu porte la mention `Néant`.

## Contrôle final

Avant la remise, vérifie les onze contrôles décrits dans la méthode. Vérifie en
particulier les lignes de code, les totaux, la cohérence entre les sections 1,
4, 5 et 11, ainsi que la validité du JSON. Dans le contrôle relatif aux
modifications, considère le nouveau rapport comme l'unique artefact autorisé ;
aucun fichier préexistant ne doit avoir été modifié. La création éventuelle du
répertoire mensuel de destination est également autorisée.
