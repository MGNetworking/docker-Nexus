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

- **`backup_nexus_volume.sh`**  
  Sauvegarde le volume Docker `nexus-data` dans une archive `tar.gz` sur le système hôte.
  Le service Nexus est arrêté automatiquement afin de garantir une sauvegarde cohérente.

- **`restore_nexus_volume.sh`**  
  Restaure une archive de sauvegarde dans le volume Docker `nexus-data`.
  Cette opération **écrase entièrement** le contenu existant du volume et est destinée aux scénarios de rollback.

### Bonnes pratiques

- Toujours effectuer les sauvegardes et restaurations **service arrêté**.
- Stocker les archives de sauvegarde hors du projet (NAS, stockage externe, dépôt privé).
- Aucun secret n’est stocké dans les scripts.

### Exemples

```bash
# Sauvegarde
./scripts/backup_nexus_volume.sh nexus-data ./backup

# Restauration
./scripts/restore_nexus_volume.sh nexus-data ./backup/nexus-data_YYYYMMDD_HHMMSS.tar.gz
```

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
