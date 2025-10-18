xcode-select --install

brew install rbenv ruby-build
rbenv install 3.2.5
rbenv local 3.2.5
ruby -v   # 3.2.5 확인

gem install bundler
# Apple Silicon이라면 잠재적 플랫폼 불일치 해소
bundle lock --add-platform arm64-darwin-23 || true

# 혹시 Gemfile.lock이 x86_64로 굳어 있으면 한 번 재생성
rm -rf vendor/bundle .bundle
bundle config set path 'vendor/bundle'
bundle add faraday-retry
bundle install

bundle exec jekyll serve