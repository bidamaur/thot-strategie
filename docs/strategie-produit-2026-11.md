# Thot Stratégie — Audit produit, offre Gratuit / Premium et évolutions (novembre 2026)

Ce document accompagne les évolutions livrées sur la branche `feat/platform-optimization` : application installable (PWA), quota gratuit paramétrable, objectifs, sollicitations encadrées, historique et statistiques, mesure d'audience, page Premium et navigation mobile.

---

## 1. Audit par profil de joueur

### Nouveau joueur (première visite)
| | Constat avant | Gravité |
|---|---|---|
| Compréhension | Accroche « Chaque coup compte » sans dire ce que propose la plateforme. | Moyenne |
| Inscription | Très simple : pseudo + mot de passe, sans e-mail. **Point fort.** | — |
| Démarrer | Pas de parcours guidé : il faut deviner « Match en ligne ». L'entraînement IA était le premier choix proposé, avant le jeu en ligne. | Moyenne |
| Après inscription | L'accueil affichait surtout un **formulaire d'édition de profil** (pseudo, pays, ville, quartier, avatar, emoji, variante), pas « que faire maintenant ». | **Haute** |
| Abandon probable | Aucune aide pour trouver amis, tournois ou clubs. Aucune incitation à revenir. | Haute |

### Joueur occasionnel
- Il trouve vite « Jouer », et le matchmaking est rapide. **Point fort.**
- **Aucun historique de ses parties visible** : les routes `points-history` et `rating-history` existaient, mais aucune page ne les affichait.
- Rien ne lui donne une raison de revenir demain : pas d'objectif, pas de série, pas de rappel.

### Joueur régulier
- Il ne voit pas sa progression : pas de courbe ELO ni de statistiques par cadence ou par couleur.
- Les points classiques et les médailles existent, mais sans objectif à court terme.

### Joueur très compétitif
- Les classements ELO par jeu et par cadence sont bien conçus. **Point fort.**
- Les règles de nul sont conformes FMJD / Lichess. **Point fort.**
- Il lui manque l'analyse : meilleure victoire, adversaires fréquents, résultats par couleur.

### Joueur intéressé par les tournois
- Les 8 formats et le Survival sont un vrai différenciateur.
- La découverte est faible : aucune mise en avant des tournois gratuits sur l'accueil.

### Joueur Premium
- **Problème d'honnêteté commerciale.** La page Premium vendait « Statistiques avancées » et un « Historique 30 / 180 / 365 jours / illimité », mais **aucune de ces fonctions n'existait**.
- Les avantages réels se limitaient à l'organisation (tournois, clubs, interclubs), à la communauté et à la suppression de la publicité.

### Joueur qui hésite à devenir Premium
- La page Premium était un tableau technique : pas de bénéfices concrets, pas de conditions d'abonnement, pas de mise en avant d'un niveau.
- Le bouton « Choisir ce niveau » renvoyait une erreur aux non-administrateurs, car le paiement réel n'est pas branché.
- Aucun message contextuel n'existait au moment où le besoin apparaît (statistiques, historique, limite atteinte).

### Joueur sur téléphone
- La barre du bas comptait 5 entrées : Accueil, Jouer, Tournois, Communauté, Portefeuille.
- **Clubs, Classements, Premium, Entraînement IA et Administration étaient inaccessibles sur mobile.** Gravité : **haute**.
- La salle de jeu avait été optimisée lors de la mission précédente : plateau prioritaire, barre d'actions collante.
- Pas d'installation possible : ni manifeste, ni service worker, ni icônes.

---

## 2. Diagnostic

**Points forts**
- Moteurs de jeu et règles officielles.
- Trois systèmes de points bien séparés.
- 8 formats de tournoi et le Survival.
- Communauté complète.
- Paramétrage administrable centralisé.
- Inscription sans friction.

**Faiblesses**
- Pas de boucle de retour quotidienne.
- Promesses Premium non tenues.
- Navigation mobile incomplète.
- Accueil connecté orienté « formulaire » plutôt que « jouer ».
- Aucune mesure d'audience.

**Opportunités**
- Application installable : forte valeur sur Android, majoritaire en Afrique.
- Objectifs et séries.
- Statistiques comme argument Premium naturel.
- Interclubs et organisation comme Premium « organisateur ».

---

## 3. Matrice Gratuit / Premium (fonctionnalités réellement présentes)

Légende des colonnes :
- **Valeur** : valeur pour l'utilisateur.
- **Coût** : coût technique.
- **Fidél.** : impact sur la fidélisation.

| Fonctionnalité | Gratuit | Premium | Valeur | Coût | Fidél. | Justification |
|---|---|---|---|---|---|---|
| Parties en ligne (amicales, classées) | Illimitées par défaut ; quota quotidien **activable** (10/j par défaut) | Illimitées (tous niveaux) | Très haute | Élevé (temps réel) | Très fort | Seul levier « volume ». Désactivé par défaut pour ne rien imposer sans validation. 7 jours de découverte sans limite. |
| Entraînement contre l'IA | Illimité | Illimité | Haute | Nul (local) | Fort | Coût serveur nul : aucune raison de limiter. |
| Tournois (participer), Survival (organiser) | Oui | Oui | Très haute | Moyen | Très fort | Cœur compétitif ; jamais décompté du quota. |
| Classement ELO, matchmaking | Identique | Identique | Très haute | — | Fort | Équité sportive non négociable. |
| Points classiques, médailles, objectifs | Oui | Oui | Haute | Faible | Fort | Gamification ouverte à tous. |
| Historique des parties | 30 jours (les anciennes sont conservées) | 180 j / 365 j / complet selon le niveau | Moyenne | Faible | Moyen | Confort ; rien n'est supprimé. |
| Statistiques essentielles (V/N/D, % victoires, classements) | Oui | Oui | Haute | Faible | Moyen | Indispensables pour progresser. |
| Statistiques avancées (courbe ELO, couleur, cadence, mode, adversaires, meilleure victoire, activité) | Non | Dès Bronze | Haute pour les réguliers | Faible | Moyen | Outil d'analyse ; aucun effet sur le jeu. |
| Amis, discussions, défis, salons publics, notifications | Oui | Oui | Très haute | Faible | Très fort | Socle social : ne jamais limiter. |
| Salons privés | Non | 1 à 10 selon le niveau | Moyenne | Faible | Moyen | Animation de communauté. |
| Organiser des tournois (formats avancés, privés, portée, capacité) | Survival, portée ville, 16 joueurs | Progressif par niveau | Haute pour les organisateurs | Moyen | Fort | Valeur d'organisation. |
| Créer un club | Selon les points (paramétrable) | 1 à 5 clubs | Haute | Faible | Fort | — |
| Rencontres interclubs (lancer) | Accepter : oui | Lancer : dès Argent | Moyenne | Moyen | Fort | Valeur « capitaine de club ». |
| Logo et couleurs du club, épingles, statistiques communautaires | Non | Selon le niveau | Faible à moyenne | Faible | Faible | Différenciation. |
| Sans publicité | Publicité hors salle de jeu | Dès Bronze | Moyenne | — | Moyen | — |
| Portefeuille, points argent | Selon le cadre légal (désactivé par défaut) | Identique | — | — | — | Jamais lié au Premium. |
| Sécurité, compte, mot de passe, blocage, signalement | Oui | Oui | — | — | — | Jamais limité. |
| Paramétrage, modération, mesure d'audience | — | — | — | — | — | **Administration** uniquement. |

**Répartition des niveaux.** Les 6 niveaux existants sont conservés ; un privilège a été ajouté : `unlimitedGames`.

| Niveau | Profil visé |
|---|---|
| Gratuit | Jouer, progresser, socle social complet |
| Bronze | Joueur régulier : illimité, statistiques avancées, 180 jours d'historique, sans publicité |
| Argent (recommandé) | Joueur de club : interclubs, tournois privés et payants, 1 salon privé, 365 jours d'historique |
| Or | Organisateur national, historique complet |
| Platine | Organisateur continental |
| Diamant | Organisateur international |

---

## 4. Règles du quota gratuit

Toutes les règles sont dans Administration › Paramètres › **Offre gratuite**.

**Ce qui compte**
- Le quota se calcule directement depuis les parties. Il n'y a **pas de compteur séparé** qui pourrait se désynchroniser.
- Comptent les parties en ligne **amicales et classées** démarrées depuis minuit (heure du serveur, comme le plafond de gain quotidien existant).
- Une partie en cours compte, ce qui empêche de lancer plusieurs parties pour contourner la limite.
- Abandon, perte au temps et déconnexion comptent : la partie a eu lieu.
- Les revanches comptent. Les défis entre amis comptent par défaut ; c'est réglable.

**Ce qui ne compte jamais**
- Les parties annulées avant le 2ᵉ coup.
- Les tournois.
- Les rencontres interclubs.
- Les parties rémunérées.
- L'entraînement contre l'IA.

**Ce qui n'est jamais bloqué**
- La vérification se fait **uniquement au lancement**. Une partie commencée n'est jamais interrompue, même à minuit.
- Période de découverte : les nouveaux comptes jouent sans limite pendant 7 jours (réglable).
- Le joueur est prévenu quand il reste peu de parties.
- À la limite, il voit des alternatives (tournoi, IA, historique) et un message Premium discret.

---

## 5. Fidélisation livrée

- **Premiers pas** (accueil, nouveaux joueurs) :
  - les étapes : première partie, profil, ami, tournoi, club, installation ;
  - elles se cochent automatiquement à partir des données réelles ;
  - le parcours peut être masqué.
- **Objectifs quotidiens et hebdomadaires** (paramétrables) :
  - récompensés **uniquement en points classiques**, jamais en ELO ni en points argent ;
  - réclamation idempotente : un double clic ne crédite qu'une fois.
- **Séries** : jours joués d'affilée et victoires consécutives.
- **Sollicitations encadrées** :
  - une seule par visite ;
  - **jamais pendant une partie, une recherche d'adversaire ou un entraînement IA**, ni dans l'administration ;
  - délai minimum entre deux fenêtres importantes ;
  - un refus n'est jamais réaffiché ;
  - nombre d'affichages et délai réglables par campagne ;
  - les liens des campagnes sont uniquement internes.
- **Campagnes administrables** : audience (tous, gratuits, Premium, nouveaux), pages ciblées, dates, fenêtre ou bandeau, variante B pour test A/B.
- **Messages Premium contextuels** :
  - sur l'historique tronqué, les statistiques avancées et la limite du jour ;
  - désactivables par l'administrateur.

---

## 6. Application installable (PWA)

- **Manifeste** : le nom, le nom court et les couleurs sont administrables. Il déclare le mode standalone, des icônes normales et « maskable » (Android), et des raccourcis (Jouer, Tournois, Mes parties).
- **Service worker prudent** :
  - **aucune mise en cache** de l'API, du temps réel, des pages, du portefeuille ou de la session ;
  - cache uniquement pour les fichiers statiques versionnés et les icônes ;
  - hors connexion, une page explique que le jeu en ligne nécessite le réseau. Rien n'est simulé.
- **Installation** :
  - Android et ordinateur : invite native du navigateur.
  - iPhone et iPad : guide en 3 étapes (Partager › Sur l'écran d'accueil › Ajouter).
  - Navigateur sans installation automatique : aide manuelle, uniquement sur demande.
- **Moment de la proposition** :
  - jamais à la première visite (3 jours de visite par défaut) ;
  - jamais si l'application est déjà installée ;
  - plus de proposition après 2 refus ; 21 jours d'attente entre deux propositions.
- **Accès permanents** : « Installer l'app » dans le menu mobile, en pied de page et dans les premiers pas.
- **Mises à jour** :
  - détection par le service worker et par l'identifiant de version du serveur ;
  - bandeau discret « Recharger » ;
  - **jamais pendant une partie** : il s'affiche en sortant de la salle ;
  - la nouvelle version n'est activée que sur clic.

---

## 7. Mesure d'audience

**Respect de la vie privée**
- Hébergée sur vos serveurs, sans service tiers.
- Liste fermée de 17 événements navigateur et 2 événements serveur.
- Ni adresse IP, ni agent utilisateur, ni empreinte : seulement la classe d'appareil et le mode « application installée ».
- « Ne pas suivre » est respecté.
- Purge automatique après 180 jours (réglable).

**Tableau de bord** (Administration › Audience et conversion)
- Inscriptions.
- Actifs du jour, de 7 jours et de 30 jours ; fidélité (actifs du jour / actifs du mois).
- Retour à 7 jours.
- Durée moyenne de visite.
- Parties par joueur actif ; taux d'annulation et d'abandon.
- Inscriptions en tournoi ; amis par joueur.
- Abonnés, activations, conversion, expirés non renouvelés.
- Visites et clics de la page Premium.
- Installations ; part des ouvertures en mode application.
- Utilisation des fonctionnalités.

**Tests A/B branchés**
- Accroche de la page Premium (organisation ou progression).
- Placement de la proposition d'installation (bandeau ou carte).
- Variante B de chaque campagne.

---

## 8. Interface

- **Accueil connecté** :
  - le formulaire de profil est replié ;
  - « Match en ligne » devient le premier choix ;
  - le panneau de progression (quota, séries, objectifs, premiers pas) est ajouté ;
  - la mention « Environnement de développement local » est retirée du pied de page.
- **Accueil visiteur** : une phrase claire dit ce que propose la plateforme.
- **Navigation mobile** :
  - un bouton « Plus » ouvre une feuille avec toutes les rubriques manquantes, plus l'installation et l'administration ;
  - zones tactiles d'au moins 48 px ;
  - prise en compte des encoches (safe-area).
- **Nouvelle page « Mes parties »** : historique filtrable et paginé, statistiques essentielles et avancées.
- **Page Premium** :
  - accroche testée en A/B et bénéfices concrets ;
  - niveau recommandé et prix ramené au jour ;
  - comparatif complet avec la première colonne figée ;
  - **conditions en clair** : paiement unique, pas de renouvellement automatique, retour à l'offre gratuite sans perte de données, aucun avantage de jeu ;
  - indication honnête quand le paiement n'est pas ouvert.
- **Pas de défilement horizontal** de page sur téléphone.

---

## 9. Limites et prochaines étapes recommandées

1. **Paiement réel** : à brancher (Mobile Money / carte). D'ici là, le Premium est affiché « bientôt disponible ».
2. **Vérification sur appareils réels** : installation Android / iOS / ordinateur et affichage mobile n'ont pas été vérifiés dans un navigateur, seulement par build, tests automatiques et requêtes HTTP.
3. **Badges** : les badges calculés existants sont conservés. Il n'y a pas de nouvelle famille de badges ni de notification « nouveau badge ».
4. **Rappels de tournoi** et **notifications push** : non livrés. Les notifications internes existantes restent configurables par chaque joueur.
5. **Édition des campagnes et objectifs** : elle se fait en JSON validé dans les paramètres, pas encore avec un éditeur visuel.
6. **Identité visuelle** : la charte existante (ardoise et sauge, Geist) est cohérente et a été conservée ; seule l'icône de l'application a été créée. Une refonte graphique n'était pas justifiée.
7. **Quota** : à activer après avoir consulté le tableau de bord. Commencer à 15 parties par jour, puis mesurer la conversion et le retour à 7 jours avant de descendre.
