{
  description = "nixarchy.microvm -- NixOS MicroVMs in the Omarchy shell: a bar widget and a full-screen keyboard menu";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;

      manifest = builtins.fromJSON (builtins.readFile ./manifest.json);

      # Exactly what the shell loads. The artifacts, tests and docs are for
      # whoever reads the repository, not for the plugin folder.
      files = [
        ./manifest.json
        ./qmldir
        ./LICENSE
        ./Model.js
        ./schema.json
        ./Panel.qml
        ./Menu.qml
        ./MicrovmState.qml
        ./MicrovmView.qml
        ./VmList.qml
        ./CreateForm.qml
        ./LogView.qml
        ./ShortcutSheet.qml
        ./microvm-binds.lua
      ];

      pluginFor = pkgs:
        # runCommand and plain copies, deliberately: omarchy-plugin-validate
        # refuses any symlink inside a plugin folder, so symlinkJoin or a
        # linkFarm would fail validation at rebuild time.
        pkgs.runCommand "nixarchy-microvm-${manifest.version}"
          {
            meta = with pkgs.lib; {
              description = "Omarchy plugin: disposable and permanent NixOS MicroVMs from the bar and a key";
              homepage = "https://github.com/olafkfreund/nixarchy-microvm";
              license = licenses.mit;
              platforms = platforms.linux;
            };
          }
          ''
            mkdir -p "$out"
            ${nixpkgs.lib.concatMapStringsSep "\n" (f: ''cp ${f} "$out/${baseNameOf f}"'') files}
          '';
    in
    {
      # The key bind, the one piece of the plugin that lives outside the plugin
      # folder. Writes ~/.config/hypr/microvm-binds.lua from the same file the
      # plugin ships, so the Nix and non-Nix installs bind the same thing.
      # bindings.lua still has to load it: pcall(require, "hypr.microvm-binds").
      homeManagerModules.default = { config, lib, ... }:
        let cfg = config.programs.nixarchy-microvm;
        in
        {
          options.programs.nixarchy-microvm.keybinding = lib.mkOption {
            # A chord only: the value lands inside a Lua string.
            type = lib.types.nullOr (lib.types.strMatching "[A-Z0-9_ +]+");
            default = "SUPER + ALT + V";
            description = "Chord that opens the MicroVMs menu, in Omarchy's o.bind syntax. Null writes no bind.";
          };

          config = lib.mkIf (cfg.keybinding != null) {
            home.file.".config/hypr/microvm-binds.lua".text =
              builtins.replaceStrings [ "SUPER + ALT + V" ] [ cfg.keybinding ]
                (builtins.readFile ./microvm-binds.lua);
          };
        };

      packages = forAll (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in rec {
          default = nixarchy-microvm;
          nixarchy-microvm = pluginFor pkgs;
        });

      checks = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          plugin = self.packages.${system}.default;
        in
        {
          default = pkgs.runCommand "nixarchy-microvm-check"
            { nativeBuildInputs = [ pkgs.nodejs pkgs.jq ]; }
            ''
              # Model.js carries all the logic, and runs under plain Node.
              cp -r ${./tests} tests
              cp ${./Model.js} Model.js
              cp ${./schema.json} schema.json
              # The harness before the tests: a harness that cannot fail makes
              # every check below it meaningless.
              node tests/selftest.js
              node tests/run.js

              # The manifest is what the shell validates at load: a typo in it
              # is a plugin that silently never appears.
              jq -e '
                .schemaVersion == 1
                and .id == "nixarchy.microvm"
                and .keepLoaded == true
                and (.kinds | index("menu") and index("bar-widget"))
                and .entryPoints.menu == "Menu.qml"
                and .entryPoints.barWidget == "Panel.qml"
              ' ${plugin}/manifest.json > /dev/null
              for f in $(jq -r '.entryPoints[]' ${plugin}/manifest.json); do
                test -f "${plugin}/$f" || { echo "entry point $f missing from the package" >&2; exit 1; }
              done

              # check: files-list
              # AGENTS.md makes the files list a rule; nothing enforced it, so a
              # new runtime file could be imported, forgotten, and still pass
              # every check while the plugin broke at load. A deny-list rather
              # than an extension allow-list, so an unrecognised new root file
              # fails until someone classifies it instead of being ignored.
              # -type f excludes directories as a class, because pluginFor
              # flattens each entry to its basename, so nothing under tests/,
              # docs/, share/ or the artifact directories could ship correctly
              # even if it were listed.
              printf '%s\n' .gitignore AGENTS.md CLAUDE.md README.md flake.lock flake.nix \
                | sort > deny
              (cd ${self} && find . -maxdepth 1 -type f -printf '%f\n') | sort > root
              comm -23 root deny > required
              ls -1 ${plugin} | sort > packaged
              comm -23 required packaged | sed 's/$/: at the repository root, missing from the files list/' >&2
              comm -13 required packaged | sed 's/$/: packaged, but not a root file outside the deny-list/' >&2
              [ -z "$(comm -3 required packaged)" ] || exit 1

              # The schema is handed to claude verbatim; a broken one is an
              # agent that never answers. Strict, and without a $schema key,
              # which claude's validator refuses.
              jq -e '.additionalProperties == false and (has("$schema") | not)' ${plugin}/schema.json > /dev/null

              # The Home Manager module swaps the chord by string replacement,
              # so the shipped file must carry the default one verbatim.
              grep -qF 'o.bind("SUPER + ALT + V", "MicroVMs",' ${plugin}/microvm-binds.lua \
                || { echo "microvm-binds.lua lost its default bind" >&2; exit 1; }

              # Without this line the bar and the menu each get their own
              # state, and "one mutation at a time" silently stops holding.
              grep -qx 'singleton MicrovmState 1.0 MicrovmState.qml' ${plugin}/qmldir \
                || { echo "qmldir does not declare the MicrovmState singleton" >&2; exit 1; }

              # omarchy-plugin-validate refuses symlinks inside a plugin. Both
              # places count: the package, and the repository itself, which
              # `omarchy plugin add` clones as the plugin folder. A symlink in
              # the repo never reaches the package (cp follows it), so the
              # package check alone would miss it.
              if [ -n "$(find ${plugin} -mindepth 1 -type l)" ]; then
                echo "symlink inside the package" >&2; exit 1
              fi
              if [ -n "$(find ${self} -mindepth 1 -type l)" ]; then
                find ${self} -mindepth 1 -type l >&2
                echo "symlink in the repository above" >&2; exit 1
              fi

              # nixarchy's own plugin validation fails the rebuild on these.
              if grep -nwE 'pacman|yay' ${plugin}/*.qml ${plugin}/*.js; then
                echo "Arch package manager reference above" >&2; exit 1
              fi

              # check: colours
              # A literal colour survives a theme switch and looks wrong. The
              # old pattern saw only double-quoted hex in *.qml, so a
              # single-quoted colour, an rgba() string, a bare colour name and
              # anything in Model.js all went past it.
              # "transparent" is deliberately allowed: no Color.* token
              # expresses it, and Menu.qml, VmList.qml:151 and :196 are right as
              # they are. Qt.rgba derived from a token is not all-literal, so
              # ShortcutSheet.qml:32 is not flagged.
              # [[:space:]] rather than \s, so the patterns need no GNU
              # extension.
              colour_hit=
              grep -nE "['\"]#[0-9a-fA-F]{3,8}['\"]" ${plugin}/*.qml ${plugin}/*.js && colour_hit=1
              grep -nE "['\"](rgba?|hsla?)\(" ${plugin}/*.qml ${plugin}/*.js && colour_hit=1
              grep -nE 'colou?r[[:space:]]*:[[:space:]]*"[a-z]+"' ${plugin}/*.qml ${plugin}/*.js \
                | grep -vF '"transparent"' && colour_hit=1
              grep -nE 'Qt\.rgba\([0-9., ]*\)' ${plugin}/*.qml ${plugin}/*.js && colour_hit=1
              if [ -n "$colour_hit" ]; then
                echo "hardcoded colour above; use a Color.* token" >&2; exit 1
              fi

              # The Pages captures have a budget (docs/img, 8 MB), so the
              # repository stays quick to clone as a plugin folder.
              if [ -d ${self}/docs/img ]; then
                size=$(du -sb ${self}/docs/img | cut -f1)
                [ "$size" -le 8388608 ] || { echo "docs/img is $size bytes, over 8 MB" >&2; exit 1; }
              fi

              touch "$out"
            '';
        });
    };
}
