{
  description = "TagStudio - Tagged file browser and metadata manager";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        nodejs = pkgs.nodejs_22;
        pnpm = pkgs.pnpm.override { inherit nodejs; };
      in
      {
        packages.default = 
          let
            pname = "tagger";
            version = "0.1.0";
          in
          pkgs.stdenv.mkDerivation {
            inherit pname version;
            src = ./.;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit pname version;
              src = ./.;
              hash = "sha256-NP0ddIbkkl8CPFSo6T4q/bKYIAksvM8eq6kvWoH0zbo=";
              fetcherVersion = 3; 
            };

          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.pnpmConfigHook
            pkgs.python3
            pkgs.gcc
            pkgs.gnumake
            pkgs.ffmpeg
            pkgs.p7zip
            pkgs.makeWrapper
          ];
          
          buildInputs = [
            pkgs.sqlite
          ];
          
          buildPhase = ''
            runHook preBuild
            
            echo "==> Manually compiling native better-sqlite3 bindings completely offline..."
            pushd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
            chmod -R +w .
            
            node ${nodejs}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --nodedir=${nodejs}
            popd

            pnpm build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/tagstudio
            cp -r dist $out/lib/tagstudio/
            cp -r node_modules $out/lib/tagstudio/

            TARGET_DIR="$out/lib/tagstudio/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release"
            mkdir -p "$TARGET_DIR"

            find node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
              -exec cp {} "$TARGET_DIR/better_sqlite3.node" \; 2>/dev/null || \
            cp -f node_modules/better-sqlite3/build/Release/better_sqlite3.node "$TARGET_DIR/better_sqlite3.node"

            mkdir -p $out/bin
            
            makeWrapper ${nodejs}/bin/node $out/bin/tagger \
              --add-flags "$out/lib/tagstudio/dist/server/index.js" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ffmpeg pkgs.p7zip ]}

            runHook postInstall
          '';

          meta = {
            description = "Metadata file manager web app";
            license = pkgs.lib.licenses.unlicense;
            platforms = pkgs.lib.platforms.linux;
            mainProgram = "tagger";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pnpm
            pkgs.python3
            pkgs.gcc
            pkgs.gnumake
            pkgs.ffmpeg
            pkgs.p7zip
            pkgs.mpv
            pkgs.yacreader
          ];

          shellHook = ''
            echo " TagStudio dev environment"
            echo "   node : $(node --version)"
            echo "   pnpm : $(pnpm --version)"
            echo ""
            echo "   Run: pnpm dev"
          '';
        };
      });
}
