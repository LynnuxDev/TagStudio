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
        packages.default = pkgs.stdenv.mkDerivation {
          name = "tagger";
          src = ./.;

          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.python3
            pkgs.gcc
            pkgs.gnumake
            pkgs.ffmpeg
            pkgs.p7zip
          ];

          configurePhase = ''
            export HOME=$TMPDIR
            export COREPACK_ENABLE_STRICT=0
            export COREPACK_ENABLE=0
            pnpm install --frozen-lockfile
          '';

          buildPhase = ''
            export HOME=$TMPDIR
            export COREPACK_ENABLE_STRICT=0
            export COREPACK_ENABLE=0
            pnpm build
          '';

          installPhase = ''
            mkdir -p $out/dist $out/node_modules
            cp -r dist/client $out/dist/
            cp -r dist/server $out/dist/
            cp -r node_modules $out/
            ln -s ${pnpm}/bin/pnpm $out/node_modules/.bin/pnpm 2>/dev/null || true
          '';

          meta = {
            description = "Metadata file manager web app";
            license = pkgs.lib.licenses.isc;
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
