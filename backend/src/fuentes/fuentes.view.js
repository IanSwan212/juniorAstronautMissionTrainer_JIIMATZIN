export function presentarFuente(fuente) {
  return {
    id: fuente.code,
    name: fuente.name,
    provider: fuente.provider,
    url: fuente.url,
    accessType: fuente.access_type,
    attribution: fuente.attribution,
    challengeResource: fuente.challenge_resource,
  };
}
