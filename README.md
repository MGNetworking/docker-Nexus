# Parti Maven

La configuration pour la connexion entre la machine locale et le dépôt
le fichier de setting.xml
/home/maxime/.m2/settings.xml

Les fichiers locaux des images créés.
/home/maxime/.m2/repository

Une config dans le projet compilé doit faire référence au domain se trouve dans le fichier de setting.xml

### Déployer vers le dépot

Pour déployer vers le dépot Commande pour déployer vers le dépot

```shell
mvn clean package deploy
```

## Parti DOCKER

Le dossier daemon.json pour la configuration `insecure-registries` sur la machine local
Cela permet une connection sans le ssh (https). Il fait être sur le réseau local du dépôt
pour que cela prenne effet

```shell
# Ubuntu
/etc/docker/daemon.json

# Nas 
/etc/docker/daemon.json
```

Dans le cas où vous avez modifier le fichier `daemon.json`, Vous devrez redémarrer le daemon Docker,
voici la commande

```shell
sudo service docker restart
```

### Ouverture de connexion distante

```shell
docker login -u admin -p x4LLM9JSq3iwTPthoqEk docker sonatype-nexus.backhole.ovh

docker login sonatype-nexus.backhole.ovh
```

### Gestion des informations d'authentification

Apres la connexion, les informations d'authentification sont généralement stockées dans le fichier de configuration sur
le système qui établie la connexion.

```shell
# Ubuntu
/home/maxime/.docker/config.json

# Nas 
/var/services/homes/maxime/.docker/config.json
```

### Récupérer une image docker Hub

Voici la commande pour récupérer une image du docker Hub puis la stocker dans le dépôt nexus personnalisé

```shell
# depuis le système host qui héberge le dépôt
docker pull 192.168.1.56:8101/ubuntu

# Avec Proxy configurer
docker pull [domain]/ubuntu
```

### Gestion des images

Pour ajouter une image vers le dépôt, vous devez la tagger vers le domain du dépôt.

```shell
# exemple
docker tag [ID-image] [nom-domain/nom-image]:[version]

# exemple depuis le système Host 
docker tag f8c20f8bbcb6 192.168.1.68:8993/alpine:2.0.0

# Exemple depuis domain
docker tag f8c20f8bbcb6 [Domain]/alpine:2.0.0
```

### Ouverture connexion

Pour ajouter une image au dépôt, vous devrez vous connecter au dépôt docker

```shell
# depuis le host 
docker login 192.168.1.68:8993

# Avec le domain
docker login [domain]
```

### Ajout au dépôt

Après l'ouverture de la connexion au dépôt docker (nexus), vous devrez l'ajouté avec la commande suivante :

```shell
docker push 192.168.1.68:8993/alpine:2.0.0

docker push [domain/alpine]:2.0.0
```

#### Fermeture la connection

Après avoir ajout votre image au dépot, vous devrez fermer la connexion

```shell
docker logout
```

### NGINX

Il est toujours utile de voir les erreurs dans Nginx

```shell
sudo cat /var/log/nginx/error.log
```

En cas de changement de config dans nginx, avoir de recharge Nginx, vous pouvez vérifier les éventuelles erreurs
commises les configurations
```shell
sudo nginx -t
```
