xcode-select --install

# 나열된 네이티브 gem을 재컴파일
gem pristine eventmachine --version 1.2.7
gem pristine ffi --version 1.16.3
gem pristine http_parser.rb --version 0.8.0
gem pristine sassc --version 2.4.0

# 그래도 안 되면 직접 재설치
gem install eventmachine -v 1.2.7 --platform=ruby
gem install ffi -v 1.16.3
gem install http_parser.rb -v 0.8.0
gem install sassc -v 2.4.0

bundle add faraday-retry
bundle install

# 실행은 가급적
bundle exec jekyll serve