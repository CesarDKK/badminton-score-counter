# App Ikon Note

Appen bruger standard Android launcher ikoner placeret i:
- `app/src/main/res/mipmap-hdpi/`
- `app/src/main/res/mipmap-mdpi/`
- `app/src/main/res/mipmap-xhdpi/`
- `app/src/main/res/mipmap-xxhdpi/`
- `app/src/main/res/mipmap-xxxhdpi/`

## Opret Tilpasset Ikon

### Metode 1: Android Studio Image Asset Studio (Anbefalet)

1. Højreklik på `app/src/main/res` i Android Studio
2. Vælg `New > Image Asset`
3. Vælg `Launcher Icons (Adaptive and Legacy)`
4. Upload dit ikon (helst 512x512 PNG med transparent baggrund)
5. Tilpas farver og forme
6. Klik `Next` og `Finish`

### Metode 2: Manuelt

Opret ikoner i følgende størrelser:
- **mdpi**: 48x48 px
- **hdpi**: 72x72 px
- **xhdpi**: 96x96 px
- **xxhdpi**: 144x144 px
- **xxxhdpi**: 192x192 px

Gem dem som:
- `ic_launcher.png` (standard kvadratisk ikon)
- `ic_launcher_round.png` (rund ikon variant)

Placer i de respektive mipmap mapper.

### Metode 3: Online Generator

Brug en online ikon generator som:
- https://icon.kitchen/
- https://romannurik.github.io/AndroidAssetStudio/

Upload dit design og download alle størrelser i én zip fil.

## Anbefalet Ikon Design

For badminton app, overvej:
- Badminton bold/shuttle
- Badminton ketcher
- Point tæller/scoreboard symboler
- Farver der matcher app temaet (#533483, #e94560)

## Nuværende Status

Appen bruger pt. Android's standard grønne robot ikon.
For en professionel app, bør du erstatte disse med et tilpasset ikon.
