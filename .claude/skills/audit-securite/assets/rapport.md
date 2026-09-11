# Rapport d'audit de sécurité

| | |
|---|---|
| **Dépôt** | `<nom>` |
| **Commit audité** | `<sha court>` sur `<branche>` |
| **Date** | `<AAAA-MM-JJ>` |
| **Mode** | `full` \| `diff <ref>` |
| **Périmètre** | `<chemins inclus>` |
| **Exclusions** | `<chemins exclus>` |
| **Référentiel** | `<référentiel>` |
| **Auditeur** | Claude — revue automatisée |

## 1. Synthèse pour la direction

`<Trois à cinq phrases, sans jargon technique. Niveau de risque global, nature des risques dominants, charge totale de remédiation en jours-homme et en budget, délai recommandé.>`

### Répartition des constats

| Sévérité | Nombre | Charge (j.h) |
|---|---|---|
| Critique | | |
| Élevée | | |
| Moyenne | | |
| Faible | | |
| Observation | | |
| **Total constats** | | |
| Pilotage (10 %) | — | |
| Contre-audit (15 %) | — | |
| Documentation | — | 0,5 |
| **Total général** | | |

**Valorisation indicative** : `<total>` j.h × `<TJM>` € = `<montant>` €

### Niveau de risque global

`Critique | Élevé | Modéré | Faible` — `<justification en une phrase>`

## 2. Périmètre et couverture

### Cartographie
`<Langages, frameworks et versions, points d'entrée, magasins de données, mécanismes d'authentification.>`

### Éléments audités
| Composant | Chemin | Points d'entrée | Couverture |
|---|---|---|---|

Couverture : `Complète | Partielle | Superficielle`

### Éléments non audités
| Élément | Raison |
|---|---|

## 3. Modèle de menace retenu

| Actif | Attaquant | Chemin d'attaque envisagé | Constats associés |
|---|---|---|---|

## 4. Tableau de bord des constats

Trié par sévérité décroissante, puis par charge croissante à sévérité égale.

| ID | Titre | Sévérité | CVSS | Confiance | CWE | Fichier:ligne | Charge | Priorité |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | | | | | | | | P1 |

Priorités : **P1** à corriger immédiatement (critique et élevée exploitables), **P2** au prochain cycle (élevée conditionnée, moyenne), **P3** en fond de tâche (faible, observations).

## 5. Constats détaillés

Un bloc par constat, identique pour tous.

### SEC-XXX — `<titre factuel, une ligne>`

| | |
|---|---|
| **Sévérité** | `<niveau>` (CVSS v4 : `<score>` — `<vecteur>`) |
| **Impact métier** | `<niveau>` — `<justification si écart avec le score technique>` |
| **Confiance** | `Haute | Moyenne` |
| **Catégorie** | `<CWE-XXX : libellé>` |
| **Référentiel** | `<clause du référentiel retenu>` |
| **Localisation** | `chemin/fichier.ext:LL-LL` (+ liste des autres occurrences) |
| **Priorité** | `P1 | P2 | P3` |

**Description**
`<Ce qui est défectueux dans le code, en deux à quatre phrases.>`

**Preuve — chemin de code**
```
<langage>
// chemin/fichier.ext:LL
<extrait minimal montrant la source, le flux et le puits>
```
`<Trace : point d'entrée → transformations → puits. Précise l'absence de contrôle identifiée.>`

**Scénario d'exploitation**
`<Description en prose : qui, avec quels prérequis, obtient quoi. Sans charge utile ni commande exécutable.>`

**Prérequis d'exploitation**
`<Aucun | Compte authentifié | Rôle privilégié | Interaction utilisateur | Accès réseau interne>`

**Remédiation recommandée**
`<Correctif de fond, pas contournement. Indique le mécanisme à mettre en place et le point d'implémentation.>`

**Mesure de contournement immédiate**
`<Palliatif déployable sous 24 h si le correctif est long, ou "Sans objet".>`

**Chiffrage**

| Poste | j.h |
|---|---|
| Analyse | |
| Développement | |
| Tests | |
| Revue | |
| Déploiement | |
| **Sous-total** | |
| Facteurs appliqués | `<facteur ×coef, ...>` ou `aucun` |
| **Total** | |

Classe : `<XS/S/M/L/XL>` — Confiance du chiffrage : `<Haute/Moyenne/Basse>`

**Validation du correctif**
`<Test à écrire ou vérification à réaliser pour prouver que la faille est fermée.>`

---

## 6. Observations et durcissement

| ID | Observation | Localisation | Bénéfice | Charge |
|---|---|---|---|---|
| OBS-001 | | | | |

## 7. Chaîne d'approvisionnement

| Dépendance | Version | CVE / Problème | Sévérité | Version cible | Rupture | Charge |
|---|---|---|---|---|---|---|

## 8. Plan de remédiation

### Lot 1 — Immédiat (< 1 semaine)
| ID | Titre | Charge | Prérequis |
|---|---|---|---|

### Lot 2 — Court terme (< 1 mois)
| ID | Titre | Charge | Prérequis |
|---|---|---|---|

### Lot 3 — Fond de tâche
| ID | Titre | Charge | Prérequis |
|---|---|---|---|

**Chemin critique** : `<dépendances entre lots, ordre imposé le cas échéant>`
**Délai estimé** : `<total j.h / CAPACITE>` jours ouvrés à `<CAPACITE>`

## 9. Causes racines

`<Deux à quatre constats transverses : ce qui, dans le processus de développement, a permis l'apparition de ces défauts. Une recommandation de processus par cause.>`

| Cause racine | Constats concernés | Recommandation processus |
|---|---|---|

## 10. Limites de l'audit

`<Liste explicite.>`

- Revue automatisée par analyse statique et lecture de code, **sans exécution ni test d'intrusion**
- Aucune validation par exploitation réelle : les constats sont théoriques jusqu'à confirmation en environnement de test
- Configuration d'exécution, infrastructure et secrets réels non audités, sauf présence dans le dépôt
- Faux négatifs possibles : ce rapport ne garantit pas l'absence d'autres vulnérabilités
- Chiffrages indicatifs, établis sans connaissance de vos contraintes d'équipe et de planning
- `<paramètres non fournis et valeurs par défaut appliquées>`
- **Ne constitue pas un audit de conformité** au sens `<référentiel>` et ne remplace pas un audit humain externe

## 11. Annexe — résumé exploitable

```json
{
  "repo": "",
  "commit": "",
  "date": "",
  "mode": "",
  "risque_global": "",
  "constats": [
    {
      "id": "SEC-001",
      "titre": "",
      "severite": "",
      "cvss": 0.0,
      "impact_metier": "",
      "confiance": "",
      "cwe": "",
      "fichiers": [],
      "priorite": "",
      "charge_jh": 0.0,
      "classe": "",
      "confiance_chiffrage": ""
    }
  ],
  "totaux": {
    "constats_jh": 0.0,
    "pilotage_jh": 0.0,
    "retest_jh": 0.0,
    "documentation_jh": 0.5,
    "total_jh": 0.0,
    "budget_eur": 0
  }
}
```