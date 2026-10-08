import shop.views


def test_module_function():
    # `shop` is the imported MODULE, not an instance of the class `Shop`.
    return shop.make_response(1)
