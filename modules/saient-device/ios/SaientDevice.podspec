Pod::Spec.new do |s|
  s.name           = 'SaientDevice'
  s.version        = '0.1.0'
  s.summary        = 'Local hardware profile for conservative Saient model recommendations'
  s.description    = 'Reads physical memory and CPU count locally without transmitting device information.'
  s.author         = 'Saient'
  s.homepage       = 'https://saient.co.uk'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
