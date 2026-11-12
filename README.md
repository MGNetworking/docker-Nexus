# Sonatype Nexus Repository Manager (Docker)

## Accès Nexus Repository Manager (environnement maîtrisé)

L’instance Sonatype Nexus Repository Manager associée à ce projet est exploitée au sein d’une infrastructure personnelle
et n’est pas exposée en permanence pour des raisons de sécurité.

Elle est utilisée comme dépôt d’artefacts interne (Maven, Docker, etc.) et peut
être rendue accessible ponctuellement à des fins de présentation technique.

L’ensemble des configurations d’exploitation, des scripts de maintenance
(sauvegarde / restauration) et du déploiement Docker sont documentés et versionnés
dans ce dépôt.

## Sommaire

- [Présentation](#présentation)
- [Architecture et périmètre](#architecture-et-périmètre)
- [Démarrage rapide](#démarrage-rapide)
- [Stockage et volumes](#stockage-et-volumes)
- [Scripts d'exploitation](#scripts-dexploitation)
- [Configuration de Nexus (nexus-config)](#configuration-de-nexus-nexus-config)
- [Configuration Docker (client)](#configuration-docker-client)
- [Utilisation Docker Registry privée](#utilisation-docker-registry-privée)
- [Notes de sécurité](#notes-de-sécurité)

---

## Présentation

Sonatype Nexus Repository Manager est un gestionnaire de dépôts permettant de stocker, proxyfier et distribuer des
artefacts logiciels (Maven, Docker, npm, etc.).

Ce projet fournit une **mise en place Dockerisée** de Nexus, orientée **exploitation** :

- déploiement via Docker Compose,
- persistance des données via **volume Docker nommé**,
- exposition sécurisée via reverse-proxy (TLS),
- scripts de **backup / restauration** pour sécuriser les mises à jour.

> ⚠️ Ce dépôt est un projet **d’infrastructure**. Il ne compile ni ne publie d’artefacts applicatifs.

---

## Architecture et périmètre

- **Runtime** : Sonatype Nexus Repository Manager (conteneur Docker)
- **Stockage** : volume Docker `nexus-data`
- **Accès** :
    - Interface Web et endpoints Maven via HTTPS (reverse-proxy)
    - Docker Registry privée via HTTPS
- **Hors périmètre** :
    - Aucun fichier `settings.xml` réel
    - Aucun secret versionné
    - Aucun pipeline CI/CD

Les fichiers sensibles (credentials, certificats, configurations réelles) sont gérés **hors de ce dépôt**.

---

## Démarrage rapide

```bash
docker compose up -d
docker compose logs -f
```

L’interface Nexus est ensuite accessible via l’URL exposée par le reverse-proxy.

---

## Stockage et volumes

Les données Nexus sont stockées dans un **volume Docker nommé** :

- Volume : `nexus-data`
- Point de montage conteneur : `/nexus-data`

Ce choix permet :

- la portabilité de l’environnement,
- des sauvegardes propres,
- une restauration rapide en cas d’échec de mise à jour.

---

## Scripts d'exploitation

Ce projet inclut des scripts destinés à faciliter l’exploitation de Nexus dans un contexte Docker.
Ils sont conçus pour une **utilisation manuelle**, lors des opérations de maintenance.

### Organisation

Les scripts sont regroupés dans le répertoire `scripts/` :

- **`backup_nexus_volume.sh`** : sauvegarde le volume `nexus-data` dans une archive `tar.gz`. [Détail ci-dessous](#sauvegarde--backup_nexus_volumesh).
- **`restore_nexus_volume.sh`** : restaure une archive dans le volume, en **écrasant** son contenu. [Détail ci-dessous](#restauration--restore_nexus_volumesh).
- **`nexus-config.mjs`** : configuration de Nexus (dépôts, accès, rôles), voir [Configuration de Nexus](#configuration-de-nexus-nexus-config).

Les deux scripts de sauvegarde et de restauration se lancent **depuis la racine du projet** (là où se trouve le
`docker-compose.yml`), car ils utilisent `docker compose` pour arrêter Nexus.

### Sauvegarde : `backup_nexus_volume.sh`

```bash
./scripts/backup_nexus_volume.sh [VOLUME] [DOSSIER_DE_SAUVEGARDE]     # défauts : nexus-data  ./backup
```

**Ce que fait le script, dans cet ordre**

1. Vérifie que le volume Docker existe.
2. Arrête Nexus (`docker compose down`) puis **vérifie qu'aucun conteneur n'utilise encore le volume**. `docker compose down`
   ne s'applique qu'au projet Compose de ce dossier : un Nexus lancé depuis un autre dossier, ou sous un autre nom de
   projet, continuerait de tourner, et une sauvegarde à chaud serait incohérente. Dans ce cas le script s'arrête, nomme
   les conteneurs concernés et leur projet Compose ; il suffit de les arrêter (`docker stop <nom>`) et de relancer.
3. Affiche la taille du volume, puis écrit l'archive en affichant l'avancement (`... 3,2G écrits`) toutes les 15 secondes.
4. Renomme l'archive et en donne la propriété à l'utilisateur qui a lancé le script.

Nexus **n'est pas relancé** : `docker compose up -d` quand la sauvegarde est terminée (message `OK: backup créé`).

**Archive incomplète : jamais de faux `.tar.gz`**

L'archive est écrite sous le nom `nexus-data_AAAAMMJJ_HHMMSS.tar.gz.partial` et **renommée seulement quand elle est
complète**. Conséquences :

- **`Ctrl-C`** (ou un signal d'arrêt) pendant la sauvegarde : le script arrête son conteneur de sauvegarde, **supprime
  l'archive incomplète** et affiche « Sauvegarde interrompue ». Il ne reste aucun `.tar.gz` tronqué qui ressemblerait à une
  sauvegarde valide. **Nexus reste arrêté** : `docker compose up -d`.
- **Erreur** pendant l'écriture (disque plein, lecture impossible...) : même comportement, la sauvegarde échoue au lieu de
  produire une archive partielle.
- **Arrêt brutal** (`kill -9`, coupure de courant) : un fichier `.partial` peut rester. Il n'est jamais pris pour une
  sauvegarde (le restaurateur le refuserait) : supprimez-le à la main. Un conteneur `nexus-backup-<horodatage>` encore actif
  se supprime avec `docker rm -f`.

**Compression et durée**

La compression est **rapide par défaut (niveau 1)**, bien plus qu'avec le niveau 9 de `gzip` : les blobs de Nexus (images
Docker, jars) sont déjà compressés, un niveau élevé coûte des minutes pour presque aucun gain. Pour plusieurs Go, comptez
quand même **plusieurs minutes** ; l'ancienne version (compression maximale, aucun affichage) dépassait 14 minutes sans
finir pour environ 17 Go.

| Variable | Défaut | Rôle |
|---|---|---|
| `GZIP_LEVEL` | `1` | niveau de compression, de 1 (le plus rapide) à 9 (le plus petit, bien plus lent) |
| `BACKUP_UID`, `BACKUP_GID` | utilisateur qui lance le script | propriétaire de l'archive |

L'archive est créée par un conteneur qui tourne en root ; le script en change le propriétaire à la fin. Elle appartient donc
à celui qui a lancé le script, et non à `root`. Il n'est pas nécessaire de lancer le script avec `sudo` (seul l'accès à
Docker est requis).

**Vérifier une archive**

```bash
gzip -t ./backup/nexus-data_AAAAMMJJ_HHMMSS.tar.gz          # intégrité (relit tout le fichier : plusieurs minutes si gros)
tar -tzf ./backup/nexus-data_AAAAMMJJ_HHMMSS.tar.gz | head   # contenu
```

### Restauration : `restore_nexus_volume.sh`

```bash
./scripts/restore_nexus_volume.sh [VOLUME] <ARCHIVE>      # défaut du volume : nexus-data ; l'archive est obligatoire
```

**Ce que fait le script, dans cet ordre**

1. **Vérifie l'intégrité de l'archive** (`gzip -t`) **avant de toucher à quoi que ce soit.** Une archive tronquée (sauvegarde
   interrompue, copie incomplète) est refusée : rien n'est modifié, Nexus tourne toujours, le volume est intact. La vérification
   relit tout le fichier : plusieurs minutes pour une grosse archive.
2. Vérifie que le volume existe.
3. Arrête Nexus (`docker compose down`) et contrôle, comme la sauvegarde, **qu'aucun conteneur n'utilise encore le volume**
   (sinon : arrêt sans avoir rien modifié).
4. **Vide entièrement le volume** (fichiers cachés compris), puis extrait l'archive dedans.

Nexus **n'est pas relancé** : `docker compose up -d`, puis `docker compose logs -f` pour suivre le démarrage.

| Variable | Rôle |
|---|---|
| `SKIP_VERIFY=1` | ignore la vérification d'intégrité de l'étape 1. Déconseillé : une archive tronquée détruirait le volume actuel sans rien pouvoir remettre à la place |

> **La restauration écrase tout le contenu actuel du volume**, sans en faire de copie. Si l'état actuel a de la valeur,
> faites d'abord une sauvegarde.

### Bonnes pratiques

- Toujours effectuer les sauvegardes et restaurations **service arrêté** (les scripts s'en chargent et le vérifient).
- **Sauvegarder avant toute opération risquée** : mise à jour de l'image, changement de configuration importante, bascule du
  routage Docker.
- Stocker les archives de sauvegarde hors du projet et hors du serveur (NAS, stockage externe, dépôt privé), et vérifier de
  temps en temps qu'une restauration fonctionne sur une machine de test.
- Aucun secret n'est stocké dans les scripts. L'archive, elle, contient **toutes** les données de Nexus (dont ses utilisateurs
  et ses réglages) : la protéger comme un secret.

### Exemples

```bash
# Sauvegarde (compression rapide par défaut)
./scripts/backup_nexus_volume.sh nexus-data ./backup

# Sauvegarde plus compacte mais plus lente
GZIP_LEVEL=6 ./scripts/backup_nexus_volume.sh nexus-data ./backup

# Restauration (écrase le volume)
./scripts/restore_nexus_volume.sh nexus-data ./backup/nexus-data_AAAAMMJJ_HHMMSS.tar.gz

# Dans les deux cas, ensuite
docker compose up -d
```

---

## Configuration de Nexus (nexus-config)

La configuration de Nexus (dépôts, accès anonyme, rôles, utilisateurs) est décrite dans un fichier versionné et
appliquée par un outil, au lieu d'être saisie à la main dans l'interface.

- `config/nexus-config.json` : l'état voulu. Aucun mot de passe : chaque utilisateur est lié à une variable
  d'environnement (`passwordEnv`). La section `contract` décrit ce que Nexus attend du reverse proxy.
- `scripts/nexus-config.mjs` : l'outil, sans dépendance (Node 18 ou plus).

```bash
export NEXUS_URL=https://sonatype-nexus.backhole.ovh NEXUS_ADMIN_PASSWORD=...   # compte administrateur

node scripts/nexus-config.mjs export --out etat-actuel.json   # photographie un Nexus existant (lecture seule)
node scripts/nexus-config.mjs check                           # compare Nexus au fichier de config (lecture seule)
node scripts/nexus-config.mjs check --public                  # + sondes anonymes et certificat TLS via le reverse proxy
node scripts/nexus-config.mjs apply --dry-run --update        # montre ce qui serait créé ou corrigé
NEXUS_CI_PASSWORD=... node scripts/nexus-config.mjs apply     # crée ce qui manque, ne touche à rien d'existant
NEXUS_CI_PASSWORD=... node scripts/nexus-config.mjs apply --update   # corrige aussi les écarts
```

- `check` ne modifie rien. Il signale les écarts (`ÉCART`), les éléments manquants (`ABSENT`) et ceux qui existent
  dans Nexus sans être dans le fichier (`EN PLUS`, simple information). Les sondes `--public` envoient des requêtes
  HTTP anonymes : elles ne partent que si l'option est donnée.
- `apply` sans `--update` ne touche jamais à un élément existant. Avec `--update`, seuls les champs en écart sont
  modifiés (le reste d'un dépôt est conservé), y compris les droits de l'accès anonyme : toujours passer par
  `--dry-run` d'abord sur un Nexus de production.
- Docker est en **routage par chemin** (`<hôte>/docker-private/<image>`, `<hôte>/docker-public/<image>`) : passer un
  dépôt existant de connecteur de port à chemin change le nom des images pour tous les clients. Le miroir
  `docker-hub` reste en connecteur de port (8102), réseau local seulement.
- Le contrat de licence (CLUF) de Nexus Community n'est jamais accepté par l'outil : à faire dans l'interface.
- Le reverse proxy (`Nginx-config/nginx/001nexus.conf`) est testé contre ce même fichier par le banc
  `Nginx-config/tests/nexus/run.sh`.

---

## Configuration Docker (client)

L’authentification à la registry Docker Nexus se fait via la commande standard :

```bash
docker login sonatype-nexus.backhole.ovh
```

Les informations d’authentification sont alors stockées côté client Docker :

```text
~/.docker/config.json
```

Aucune configuration Docker sensible n’est versionnée dans ce dépôt.

---

## Utilisation Docker Registry privée

### Build d’une image

```bash
docker build -t sonatype-nexus.backhole.ovh/nom-image:version .
```

### Tag d’une image existante

```bash
docker tag IMAGE_ID sonatype-nexus.backhole.ovh/nom-image:version
```

### Push

```bash
docker push sonatype-nexus.backhole.ovh/nom-image:version
```

### Pull

```bash
docker pull sonatype-nexus.backhole.ovh/nom-image:version
```

---

## Notes de sécurité

- Aucun mot de passe, token ou certificat n’est versionné.
- Les fichiers de configuration réels sont gérés dans des dépôts privés dédiés.
- Le reverse-proxy assure la terminaison TLS et le contrôle d’accès.

Ce projet sert de **plateforme de démonstration** pour illustrer une approche propre et maîtrisée
de l’exploitation d’un dépôt d’artefacts avec Docker.
