Pod::Spec.new do |s|
  s.name           = 'SaientImageQuality'
  s.version        = '0.1.0'
  s.summary        = 'Small local image quality checks for Saient WAN source frames'
  s.description    = 'Computes source dimensions, brightness, contrast, clipping, and approximate sharpness without uploading the image.'
  s.author         = 'Saient'
  s.homepage       = 'https://saient.co.uk'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'CoreGraphics'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
