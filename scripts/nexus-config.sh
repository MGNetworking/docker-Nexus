#!/usr/bin/env bash
# Lance l'outil nexus-config sans copier-coller de commandes ni de mots de passe.
#
# Usage :
#   ./scripts/nexus-config.sh audit [--url URL]    LECTURE SEULE, en une commande : photographie de Nexus
#                                                  (etat-actuel.json), comparaison au fichier de config, sondes du
#                                                  reverse proxy et certificat TLS, puis simulation de ce qui serait
#                                                  créé ou corrigé. Rien n'est modifié.
#   ./scripts/nexus-config.sh apply [--url URL]    montre la simulation, demande confirmation, puis applique
#                                                  (apply --update). Un seul mot de passe admin à saisir.
#   ./scripts/nexus-config.sh check|export [...]   directement, les options sont transmises à l'outil
#
# Adresse de Nexus : --url, sinon NEXUS_URL, sinon contract.publicUrl de config/nexus-config.json.
# Mots de passe : demandés SANS AFFICHAGE (rien dans l'historique du terminal), sauf s'ils sont déjà dans
# l'environnement : NEXUS_ADMIN_PASSWORD (et NEXUS_ADMIN_USER, défaut admin) ; pour apply, le mot de passe de chaque
# utilisateur du fichier de config (variable passwordEnv, ex. NEXUS_CI_PASSWORD) : à laisser vide s'il existe déjà.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$HERE/nexus-config.mjs"
CONFIG="$HERE/../config/nexus-config.json"

die() { echo "Erreur : $*" >&2; exit 1; }

usage() { sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

command -v node >/dev/null 2>&1 || die "Node introuvable (version 18 ou plus requise)."
[[ -f "$TOOL" ]] || die "outil introuvable : $TOOL"

CMD="${1:-}"
case "$CMD" in
  audit|apply|check|export) shift ;;
  -h|--help|"") usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# --url éventuel, pour l'afficher et le transmettre explicitement.
URL="${NEXUS_URL:-}"
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [[ "${ARGS[i]}" == "--url" ]]; then URL="${ARGS[i + 1]:-}"; fi
done
if [[ -z "$URL" ]]; then
  URL="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).contract.publicUrl||"")}catch{}' "$CONFIG" | tr -d '\r')"
fi
[[ -n "$URL" ]] || die "adresse de Nexus introuvable : utiliser --url ou renseigner contract.publicUrl dans $CONFIG"
URL="${URL%/}"

# Demande un secret sans l'afficher, sauf s'il est déjà dans l'environnement. $3 = "optionnel" accepte une réponse vide.
ask_secret() {
  local var=$1 prompt=$2 optional=${3:-} value=""
  if [[ -n "${!var:-}" ]]; then return 0; fi
  IFS= read -r -s -p "$prompt" value || true
  echo >&2
  if [[ -z "$value" && "$optional" != "optionnel" ]]; then die "$var : mot de passe vide."; fi
  # shellcheck disable=SC2163  # $var contient le NOM de la variable à exporter, c'est voulu
  if [[ -n "$value" ]]; then printf -v "$var" '%s' "$value"; export "$var"; fi
}

echo "Nexus : $URL"
ask_secret NEXUS_ADMIN_PASSWORD "Mot de passe de ${NEXUS_ADMIN_USER:-admin} sur Nexus : "

case "$CMD" in
  audit)
    node "$TOOL" audit --url "$URL" ${ARGS[@]+"${ARGS[@]}"}
    ;;

  check|export)
    node "$TOOL" "$CMD" --url "$URL" ${ARGS[@]+"${ARGS[@]}"}
    ;;

  apply)
    # Mots de passe des utilisateurs du fichier de config (nécessaires seulement si l'utilisateur n'existe pas encore).
    # La liste est d'abord lue dans un tableau : dans une boucle « while read ... < <(...) », les saisies de
    # ask_secret liraient la sortie de node au lieu du clavier.
    PWVARS=()
    while IFS= read -r entry; do
      [[ -n "$entry" ]] && PWVARS+=("$entry")
    done < <(node -e 'try{for(const u of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).users||[])if(u.passwordEnv)console.log(u.passwordEnv+" "+u.userId)}catch{}' "$CONFIG" | tr -d '\r')
    for entry in ${PWVARS[@]+"${PWVARS[@]}"}; do
      var="${entry%% *}"
      user="${entry#* }"
      echo "Le compte « ${user} » est un NOUVEAU compte Nexus (pour Jenkins et les postes de dev), distinct de admin."
      ask_secret "$var" "Mot de passe À CHOISIR pour « ${user} » (vide s'il existe déjà sur Nexus) : " optionnel
    done

    echo
    echo "=== Simulation (rien n'est modifié) ==="
    node "$TOOL" apply --update --dry-run --url "$URL" ${ARGS[@]+"${ARGS[@]}"}

    echo
    echo "Ce qui est marqué [FAIT] ci-dessus sera réellement appliqué sur : $URL"
    ANSWER=""
    IFS= read -r -p "Appliquer ? Taper « oui » pour continuer : " ANSWER || true
    if [[ "$ANSWER" != "oui" ]]; then
      echo "Annulé : rien n'a été modifié."
      exit 1
    fi

    echo
    echo "=== Application ==="
    node "$TOOL" apply --update --url "$URL" ${ARGS[@]+"${ARGS[@]}"}
    ;;
esac
