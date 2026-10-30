# Factures

Application web de facturation pour indépendant belge : clients, factures au jour presté ou au forfait, PDF prêt à envoyer.

## Ce qu'elle fait

- **Clients** : adresse, pays, n° de TVA, conditions de paiement propres à chaque client (fin du mois suivant la prestation, ou X jours après la facture).
- **Descriptions réutilisables** par client, avec tarif journalier ou forfait. Les champs `{mois}` (Septembre 2026), `{month}` (September 2026), `{jours}` et `{tarif}` se remplissent à chaque facture. Une description tapée sur une facture peut être mémorisée pour le client en un clic, et les descriptions déjà facturées sont proposées.
- **TVA selon le pays du client** :
  - Belgique : 21 %.
  - Autre pays de l'UE (Luxembourg…) : 0 %, avec la mention « Autoliquidation » (art. 196 de la directive 2006/112/CE).
  - Hors UE (Royaume-Uni…) : 0 %, avec la mention « non soumise à la TVA belge » (art. 21, § 2 du Code de la TVA).
  - Le taux et la mention restent modifiables facture par facture.
- **Numérotation** continue au format `2026/047`, qui repart à 001 chaque année.
- **Communication structurée** belge (`+++xxx/xxxx/xxxxx+++`) sur chaque facture (une nouvelle par numéro), et **QR code de paiement** (EPC) lu par les apps bancaires.
- **Aperçu PDF en direct** pendant la saisie, téléchargement en `2026_047.pdf`.
- Suivi payé / à payer / en retard, montants du trimestre pour la déclaration TVA.

## Où sont les données ?

Uniquement dans le navigateur de l'ordinateur qui utilise l'application (stockage local). Rien n'est envoyé à un serveur, et ce dépôt ne contient aucune donnée de facturation.

Exportez régulièrement une sauvegarde (Réglages → Exporter une sauvegarde) : c'est aussi ce qui permet de passer sur un autre ordinateur ou un autre navigateur.

## Lancer en local

Ouvrez `index.html` dans un navigateur, ou servez le dossier :

```sh
python3 -m http.server 8000
```

Aucune étape de build. Bibliothèques incluses dans `vendor/` : [jsPDF](https://github.com/parallax/jsPDF) (MIT) et [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
