# Sonatype nexus Repository Manager

* [Information](#information)
* [Maven configuration](#maven-configuration)
    * [settings.xml](#settingsxml)
    * [repository](#repository)
* [Docker configuration](#docker-configuration)
    * [daemon.json](#daemonjson)
    * [config.json](#configjson)
* [Docker private](#docker-private)
    * [BUILD une image](#build-une-image)
    * [TAG une image](#tag-une-image)
    * [LOGIN au dépôt](#login-au-dépôt)
    * [PULL vers le dépôt](#pull-vers-le-dépôt)
    * [PUSH vers le dépôt](#push-vers-le-dépôt)
    * [LOGOUT du dépôt](#logout-du-dépôt)

### Information

Sonatype Nexus Repository Manager est un gestionnaire de dépôts qui permet aux équipes de développement de stocker et de
gérer des artefacts logiciels tels que des bibliothèques, des composants et des packages.

Il est souvent utilisé dans le contexte de développement logiciel, notamment avec des systèmes de gestion de versions
tels que Maven, npm, Docker, et d'autres.

`Gestion des dépendances`   
Il facilite la gestion des dépendances logicielles en fournissant un emplacement centralisé
pour stocker et partager des artefacts. Cela contribue à assurer la cohérence des versions des bibliothèques utilisées
dans un projet.

`Intégration avec des outils de construction`  
Nexus Repository Manager est souvent utilisé en conjonction avec des
outils de construction tels que Maven. Il peut servir de proxy pour télécharger des dépendances à partir d'Internet,
réduisant ainsi la dépendance directe sur des dépôts distants.

`Support pour différents types d'artefacts `  
Il prend en charge divers types d'artefacts, y compris les fichiers JAR, les
images Docker, les packages npm, les artefacts RubyGems, etc.

`Gestion des droits d'accès`  
Il offre des fonctionnalités de gestion des droits d'accès, ce qui signifie que vous pouvez
contrôler qui peut accéder et modifier les différents dépôts.

`Sécurité`   
Sonatype Nexus Repository Manager met l'accent sur la sécurité en analysant les artefacts pour détecter d'
éventuelles vulnérabilités et en fournissant des mécanismes pour garantir l'intégrité des artefacts.

`Réplication et synchronisation`  
Il permet la réplication de dépôts entre différentes instances, facilitant la
distribution des artefacts dans des environnements distribués.

`Extensibilité`
Nexus Repository Manager est extensible, ce qui signifie que vous pouvez intégrer des plugins pour
étendre ses fonctionnalités en fonction des besoins spécifiques de votre organisation.

Globalement, Sonatype Nexus Repository Manager joue un rôle crucial dans l'écosystème de développement logiciel en
facilitant la gestion des dépendances, en assurant la sécurité des artefacts, et en fournissant un moyen centralisé de
stocker et de partager des composants logiciels.

## Maven configuration

Dans chaque projet maven en connexion le référentiel, vous devez avoir :

* Une configuration de connexion vers ce référentiel contenu dans le fichier `settings.xml`
* Une configuration dans le `pom.xml` de votre projet

### settings.xml

Le fichier `settings.xml` dans Maven est un fichier de configuration qui permet de définir des paramètres spécifiques à
votre environnement Maven.

Ce fichier contient des configurations telles que les paramètres de serveur, les profils, les référentiels (
repositories), les plug-ins, et d'autres paramètres liés à Maven.

La configuration pour la connexion entre la machine locale et le dépôt se trouve dans le fichier de `~/.m2/settings.xml`

### repository

Le répertoire `~/.m2/repository` est le répertoire local des référentiels Maven. Il s'agit d'un répertoire dans le
répertoire utilisateur (par exemple, dans le répertoire personnel de l'utilisateur) où Maven stocke les artefacts
téléchargés depuis les référentiels distants.

Chaque fois que vous exécutez une tâche Maven (par exemple, `mvn clean install`), Maven télécharge les dépendances
nécessaires depuis les référentiels définis dans le fichier pom.xml. Ces dépendances sont ensuite stockées localement
dans le répertoire `~/.m2/repository`.

Cela est fait pour éviter de télécharger les mêmes dépendances à chaque fois que vous
construisez votre projet, ce qui accélère le processus de build et réduit la dépendance à une connexion Internet
constante.

### Déployer vers le dépot

Pour déployer vers le dépot 
```shell
mvn clean package deploy
```

## Docker configuration

### daemon.json

Le fichier `daemon.json` est utilisé pour configurer divers paramètres du démon Docker (le service principal qui gère
les
conteneurs sur une machine). Ce fichier est généralement situé dans le répertoire de configuration de Docker sur le
système hôte.

Voici quelques-unes des configurations courantes que l'on peut spécifier dans le fichier `daemon.json` :

`Paramètres du registre Docker`  
Vous pouvez spécifier des configurations liées à la communication avec les registres
Docker, tels que les adresses des registres, les certificats, etc.

`Paramètres réseau`  
Il est possible de configurer des paramètres liés au réseau, comme l'adresse IP du démon Docker, les
interfaces réseau à utiliser, etc.

`Paramètres de stockage`  
Vous pouvez définir des options de stockage, telles que le chemin d'accès du stockage des
images Docker, la configuration des volumes, etc.

`Options de sécurité`  
Des configurations de sécurité, comme la spécification de certificats TLS, peuvent également être
définies dans ce fichier.

`Configuration des journaux`  
Vous pouvez spécifier des options de journalisation pour contrôler la manière dont les
journaux Docker sont gérés.

Autres options de configuration : Il existe de nombreuses autres options de configuration que vous pouvez spécifier en
fonction de vos besoins spécifiques.

L'option : `insecure-registries`  
Cette option est utilisée pour spécifier une liste de registres Docker qui sont considérés comme "non sécurisés" en ce
qui concerne la communication sécurisée (HTTPS/TLS). Lorsque vous travaillez avec des registres Docker qui utilisent le
protocole HTTP au lieu de HTTPS, vous devez ajouter ces registres à la liste `insecure-registries` pour informer Docker
que la communication avec ces registres ne nécessite pas de connexion sécurisée.

Exemple de configuration de cette option dans le fichier `daemon.json`

```shell
{
  "insecure-registries": [
    "192.168.1.67:8103",
    "192.168.1.67:8104"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Dans cette exemple le serveur ciblé se trouve à l'adresse IP : `192.168.1.67`.
Les Ports peuvent multiples selon la configuration du dépôt `8103`, `8104` ainsi de suite. En d'autre térme, vous pouvez
avoir plusieurs dépôts.

Après la modification de ce fichier, vous devez recharger la configuration Docker. À voir selon votre système

```shell
sudo systemctl restart docker
sudo systemctl status docker

sudo service docker restart
sudo service docker status
```

### config.json

Apres la connexion, les informations d'authentification sont stockées dans le fichier `config.json` sur
le système qui établie la connexion. Cela permet de ne pas avoir à entrer votre login pour chaque connexion.

```shell
# Ubuntu
/home/maxime/.docker/config.json

# Nas 
/var/services/homes/maxime/.docker/config.json
```

## Docker private

### BUILD une image

Création d'une image dans le but de l'ajouter au dépôt privet

```shell
# Syntaxe
docker build -t sonatype-nexus.backhole.ovh/[nom image]:[version] [context]
 
# Exemple
docker build -t sonatype-nexus.backhole.ovh/jenkins-max:v1.0.0 .
```

### TAG une image

Si vous avez une image qui ne porte pas la référence du dépot : `sonatype-nexus.backhole.ovh`, il est possible de la
transformer dans le but de l'ajouter. Pour cela, vous devez la Tagger

```shell
# exemple
docker tag [ID-image] [nom-domain/nom-image]:[version]

# Depuis le domain
docker tag f8c20f8bbcb6  sonatype-nexus.backhole.ovh/alpine:2.0.0
```

### LOGIN au dépôt

La connexion au dépôt et indispensable pour Pull ou Push une image docker vers celui-ci.
Ce dépôt est privé, il est configuré pour ne donner l'accès qu'à la personne possèdent une autorisation.

```shell
docker login sonatype-nexus.backhole.ovh
```

### PULL vers le dépôt

En 1er, vous devrez être authentifié au dépôt voir [Connexion au dépôt](#connexion-au-dépôt).
Pour récupérer une image du dépôt privet personnalisé puis, suivé l'exemple suivant :

```shell
docker pull sonatype-nexus.backhole.ovh/[images]:[version]

# Avec Proxy configurer
docker pull [domain]/ubuntu:latest
```

### PUSH vers le dépôt

En 1er, vous devrez être authentifié au dépôt voir [Connexion au dépôt](#connexion-au-dépôt).
Après l'ouverture de la connexion au dépôt docker (nexus), vous devrez l'ajouté avec la commande suivante :

```shell
docker push sonatype-nexus.backhole.ovh/[images]:[version]

docker push [domain/alpine]:latest
```

### LOGOUT du dépôt

Après avoir ajout votre image au dépot, vous devrez fermer la connexion, ne pas oublier de préciser le register.

```shell
# exemple 
docker logout <registre>

# Le dépôt sonatype-nexus.backhole.ovh
docker logout sonatype-nexus.backhole.ovh
```

Le message de fermeture :

```shell
# Si vous avez bien fermer le dépôt : 
Removing login credentials for sonatype-nexus.backhole.ovh

# Si vous avez mal fermer le dépôt :
Removing login credentials for https://index.docker.io/v1/
```
