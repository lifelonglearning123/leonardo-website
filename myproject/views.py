from django.http import HttpResponse

def homepage(request):
    #return render(request, 'home.html')
    return HttpResponse('Hello, world. You\'re at the polls index.')